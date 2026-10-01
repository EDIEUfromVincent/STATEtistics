// 칸 판독기 두 개: 판독 A = Claude (Anthropic API), 판독 B = 로컬 모델 (Spark의 Ollama).
// 서로 다른 계열이어야 같은 착각을 함께 할 가능성이 낮다. 두 판독이 같을 때만 자동 확정한다(브라우저 decide.ts).
// 받는 것은 "빈 양식 칸 | 학생 칸" PNG 조각뿐이다. 쪽 전체·이름 칸·정답은 받지 않는다.

import Anthropic from "@anthropic-ai/sdk";
import type { TeacherKeys } from "../../lib/server/auth";
import { AssessmentApiError, callGemini, geminiConfig } from "./_gemini";

export type CellInput = { id: string; hint: string; blank: string; student: string };
export type CellReading = { answer: string; formDiffers: boolean; multipleMarks: boolean };

// USD per 1M tokens (추정용 — 실제 청구액은 Anthropic 콘솔이 기준)
const CLAUDE_PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};

/** 선생님 키에 맞춘 판독기 설정. 주 판독은 Gemini(있으면), 확인 판독은 Anthropic 키가 있을 때만 */
export function readerConfig(keys?: TeacherKeys) {
  const claudeModel = process.env.CLAUDE_READER_MODEL?.trim() || "claude-opus-5-5";
  const gemini = geminiConfig(keys);
  const forced = process.env.CELL_READER?.trim().toLowerCase();
  const provider = forced === "claude" || (!gemini.apiKey && keys?.anthropic) ? "claude" : "gemini";
  return {
    provider,
    geminiReady: Boolean(gemini.apiKey) && gemini.paidTier,
    geminiModel: process.env.GEMINI_READER_MODEL?.trim() || "gemini-3.8-flash",
    claudeReady: Boolean(keys?.anthropic),
    claudeModel,
    claudePrice: CLAUDE_PRICES[claudeModel] ?? [4, 20],
    // 확인 판독기: 주 판독이 "정답"으로 읽은 칸만 다른 계열 모델로 다시 읽는다 (Anthropic 키가 있을 때)
    verifyModel: keys?.anthropic ? process.env.CELL_VERIFIER_MODEL?.trim() || "claude-sonnet-5-5" : "",
    // 예: http://127.0.0.1:18114 (Mac에서 Spark Ollama로 열린 터널). Railway에서는 닿지 않으므로 비워 둔다
    localUrl: process.env.LOCAL_READER_URL?.trim().replace(/\/+$/, "") || "",
    localModel: process.env.LOCAL_READER_MODEL?.trim() || "gemma4:31b",
  };
}

const RULES = `- 둘째 이미지에서 학생이 손으로 더한 글씨나 표시만 보고 답하세요. 인쇄된 글자는 답이 아닙니다.
- 손으로 쓴 글씨가 있으면 보이는 그대로 옮겨 적습니다. 고치거나 추측하거나 문제를 풀지 마세요.
- ( 가 / 나 ) 처럼 고르는 칸이면, 손으로 동그라미·밑줄·체크를 한 낱말 하나만 적습니다.
- 보기 번호를 고르는 문항이면 학생이 고른 번호를 ③처럼 적습니다.
- 빈 양식과 다른 손글씨나 표시가 없으면 added는 false, answer는 반드시 빈 문자열입니다.
- 두 이미지의 인쇄된 글자(문제 글, 보기)가 서로 다르면 form_differs를 true로 합니다.
- 학생이 서로 다른 답을 두 군데 이상 표시했으면(예: 보기에 ○표를 하고 문제 옆에 다른 번호를 적음, 두 보기에 모두 ○표) multiple_marks를 true로 합니다. 지운 흔적만 있으면 false입니다.
- "답의 종류"는 참고일 뿐입니다. 글씨가 그 종류로 읽히면 그렇게 적고, 전혀 다르게 보이면 보이는 대로 적으세요.`;

const ONE_SCHEMA = {
  type: "object",
  properties: { added: { type: "boolean" }, answer: { type: "string" }, form_differs: { type: "boolean" }, multiple_marks: { type: "boolean" } },
  required: ["added", "answer", "form_differs", "multiple_marks"],
  additionalProperties: false,
};

function parseOne(v: unknown): CellReading {
  const r = v as { added?: unknown; answer?: unknown; form_differs?: unknown; multiple_marks?: unknown };
  const answer = r.added === true && typeof r.answer === "string" ? r.answer.trim().slice(0, 1000) : "";
  return { answer, formDiffers: r.form_differs === true, multipleMarks: r.multiple_marks === true };
}

/** 판독 A: 학생 한 명의 칸을 요청 한 번에 (안내문을 칸마다 반복해서 내지 않는다) */
export async function readWithClaude(cells: CellInput[], keys: TeacherKeys, model?: string) {
  const cfg = readerConfig(keys);
  const useModel = model ?? cfg.claudeModel;
  const client = new Anthropic({ apiKey: keys.anthropic });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: `시험지의 답 칸 ${cells.length}개입니다. 칸마다 이미지 두 장이 이어집니다: 첫째는 아무것도 쓰지 않은 빈 양식, 둘째는 학생이 푼 시험지의 같은 칸입니다.\n${RULES}\n칸마다 id, added, answer, form_differs, multiple_marks를 적으세요.` },
  ];
  for (const c of cells) {
    content.push({ type: "text", text: `칸 ${c.id}${c.hint ? ` (답의 종류: ${c.hint})` : ""}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: c.blank } });
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: c.student } });
  }
  const schema = {
    type: "object",
    properties: {
      cells: {
        type: "array",
        items: { ...ONE_SCHEMA, properties: { id: { type: "string", enum: cells.map(c => c.id) }, ...ONE_SCHEMA.properties }, required: ["id", ...ONE_SCHEMA.required] },
      },
    },
    required: ["cells"],
    additionalProperties: false,
  };
  let response;
  try {
    response = await client.beta.messages.create({
      model: useModel,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new AssessmentApiError("Anthropic API 키가 유효하지 않습니다. \"내 API 키\"에서 다시 넣어 주세요.", 403);
    if (error instanceof Anthropic.RateLimitError) throw new AssessmentApiError("Claude 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", 429);
    if (error instanceof Anthropic.APIError) throw new AssessmentApiError(`Claude 요청 실패 (${error.status})`, 502);
    throw error;
  }
  if (response.stop_reason === "refusal") throw new AssessmentApiError("Claude가 이 요청을 거절했습니다.", 502);
  if (response.stop_reason === "max_tokens") throw new AssessmentApiError("Claude 응답이 잘렸습니다.", 502);
  const text = response.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("");
  let data: { cells?: Array<Record<string, unknown>> };
  try {
    data = JSON.parse(text);
  } catch {
    throw new AssessmentApiError("Claude 응답을 해석하지 못했습니다.", 502);
  }
  const out = new Map<string, CellReading>();
  for (const r of data.cells ?? []) if (typeof r.id === "string") out.set(r.id, parseOne(r));
  const [pin, pout] = CLAUDE_PRICES[useModel] ?? cfg.claudePrice;
  const usage = { input: response.usage.input_tokens, output: response.usage.output_tokens };
  return { readings: out, model: response.model, usage, usd: (usage.input * pin + usage.output * pout) / 1e6 };
}

/** 판독 A (Gemini를 고른 경우): Claude와 같은 조각·같은 규칙으로 학생 한 명을 요청 한 번에 */
export async function readWithGemini(cells: CellInput[], keys: TeacherKeys) {
  const cfg = readerConfig(keys);
  const gemini = { ...geminiConfig(keys), model: cfg.geminiModel };
  const parts: unknown[] = [
    { text: `시험지의 답 칸 ${cells.length}개입니다. 칸마다 이미지 두 장이 이어집니다: 첫째는 아무것도 쓰지 않은 빈 양식, 둘째는 학생이 푼 시험지의 같은 칸입니다.\n${RULES}\n칸마다 id, added, answer, form_differs, multiple_marks를 적으세요.` },
  ];
  for (const c of cells) {
    parts.push({ text: `칸 ${c.id}${c.hint ? ` (답의 종류: ${c.hint})` : ""}` });
    parts.push({ inlineData: { mimeType: "image/png", data: c.blank } });
    parts.push({ inlineData: { mimeType: "image/png", data: c.student } });
  }
  const schema = {
    type: "OBJECT",
    properties: {
      cells: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { id: { type: "STRING", enum: cells.map(c => c.id) }, added: { type: "BOOLEAN" }, answer: { type: "STRING" }, form_differs: { type: "BOOLEAN" }, multiple_marks: { type: "BOOLEAN" } },
          required: ["id", "added", "answer", "form_differs", "multiple_marks"],
        },
      },
    },
    required: ["cells"],
  };
  // 시간 초과·일시 오류는 한 번만 다시 시도한다 (설정·키 오류는 바로 알린다)
  let result;
  try {
    result = await callGemini(gemini, parts, schema);
  } catch (error) {
    if (error instanceof AssessmentApiError && (error.status === 503 || error.status === 403)) throw error;
    result = await callGemini(gemini, parts, schema);
  }
  const { data, usage } = result;
  const out = new Map<string, CellReading>();
  for (const r of (Array.isArray(data.cells) ? data.cells : []) as Array<Record<string, unknown>>) if (typeof r.id === "string") out.set(r.id, parseOne(r));
  // 생각 토큰은 출력 요금으로 청구된다
  const usd = (usage.input * gemini.priceInputPerM + (usage.output + usage.thoughts) * gemini.priceOutputPerM) / 1e6;
  return { readings: out, model: gemini.model, usage: { input: usage.input, output: usage.output + usage.thoughts }, usd };
}

/** 판독 B: 로컬 Ollama. 비전 모델 한 번에 이미지 두 장씩, 칸마다 차례로 (GPU 하나를 나눠 쓴다) */
export async function readWithLocal(cells: CellInput[]) {
  const cfg = readerConfig();  // 로컬 판독기는 선생님 키를 쓰지 않는다
  const out = new Map<string, CellReading>();
  for (const c of cells) {
    const prompt = `두 이미지는 시험지의 같은 칸입니다. 첫째는 아무것도 쓰지 않은 빈 양식, 둘째는 학생이 푼 시험지입니다.\n${RULES}${c.hint ? `\n답의 종류: ${c.hint}` : ""}\nJSON으로만 답하세요.`;
    const response = await fetch(`${cfg.localUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.localModel, stream: false, think: false, options: { temperature: 0 }, format: ONE_SCHEMA,
        messages: [{ role: "user", content: prompt, images: [c.blank, c.student] }],
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new AssessmentApiError(`로컬 판독기 오류 (${response.status})`, 502);
    const payload = await response.json();
    try {
      out.set(c.id, parseOne(JSON.parse(payload?.message?.content ?? "")));
    } catch {
      // 이 칸만 판독 실패 → 브라우저에서 교사 확인으로 간다
    }
  }
  return { readings: out, model: cfg.localModel };
}
