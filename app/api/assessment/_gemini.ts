import { AuthError, requireTeacher, teacherKeys, type TeacherKeys } from "../../lib/server/auth";

// 채점용 Gemini 중계. 요청한 선생님(구글 로그인)의 API 키로 부른다. 서버가 받는 것은 이름 칸을 가린 페이지 이미지와 이름을 가린 서술형 텍스트뿐이다.
// 이미지·텍스트는 저장하지 않고, 로그에는 해시와 크기만 남긴다.

export class AssessmentApiError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "AssessmentApiError";
    this.status = status;
  }
}

export function geminiConfig(keys?: TeacherKeys) {
  return {
    apiKey: keys?.gemini ?? "",
    model: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
    // 무료 등급은 입력 데이터가 제품 개선에 쓰일 수 있어 학생 자료에 쓰지 않는다 (선생님이 "유료 등급 키"라고 표시해야 쓴다)
    paidTier: Boolean(keys?.geminiPaid),
    // 요금표 기준 추정용 (USD per 1M tokens). 실제 청구액은 각 선생님의 Google Cloud 결제 화면이 기준이다
    priceInputPerM: Number(process.env.GEMINI_PRICE_INPUT_PER_M) || 0.3,
    priceOutputPerM: Number(process.env.GEMINI_PRICE_OUTPUT_PER_M) || 2.5,
    usdKrw: Number(process.env.USD_KRW) || 1400,
  };
}

/**
 * 글씨를 옮겨 적는 일에는 '생각' 토큰이 필요 없다. 생각 토큰은 출력 요금으로 청구되므로 끈다.
 * gemini-2.5 flash 계열은 thinkingBudget 0으로 끌 수 있다(2.5 pro는 끌 수 없음).
 * 다른 모델은 GEMINI_THINKING_BUDGET으로 직접 정한다.
 */
function thinkingConfig(model: string) {
  // Gemini 3 계열은 생각 수준(low/medium/high)으로 정한다. 기본값에서는 생각이 폭주해 2분 제한에 걸리는 일이 있었다
  const level = process.env.GEMINI_THINKING_LEVEL?.trim();
  if (level && /^gemini-3/.test(model)) return { thinkingLevel: level };
  const env = process.env.GEMINI_THINKING_BUDGET?.trim();
  if (env) return { thinkingBudget: Number(env) };
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  return undefined;
}

/** 로그인한 선생님과 그 선생님의 API 키. 로그인하지 않았으면 막는다 */
export async function teacherContext(request: Request) {
  const teacher = await requireTeacher(request);
  rateLimit(`t${teacher.id}`);
  return { teacher, keys: await teacherKeys(teacher.id) };
}

export function needGemini(keys: TeacherKeys) {
  const cfg = geminiConfig(keys);
  if (!cfg.apiKey) throw new AssessmentApiError("\"내 API 키\"에서 Gemini API 키를 넣어 주세요.", 403);
  if (!cfg.paidTier) throw new AssessmentApiError("학생 자료는 Gemini 유료 등급 키로만 처리합니다. 유료 등급 키라면 \"내 API 키\"에서 유료 등급이라고 표시해 주세요.", 403);
  return cfg;
}

export async function assertReady(request: Request) {
  const { keys } = await teacherContext(request);
  return needGemini(keys);
}

const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60_000;
const MAX_REQUESTS = 300; // 학생 1명당 판독 1번 + 서술형 여유 (여러 반을 연달아 채점해도 넉넉하게)

function rateLimit(who: string) {
  const ip = who;
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) throw new AssessmentApiError("요청이 너무 많습니다. 10분 뒤에 다시 시도해 주세요.", 429);
  recent.push(now);
  hits.set(ip, recent);
}

export async function audit(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event, time: new Date().toISOString(), ...fields }));
}

export async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

type Schema = Record<string, unknown>;
export type Usage = { input: number; output: number; thoughts: number };

export async function callGemini(cfg: ReturnType<typeof geminiConfig>, parts: unknown[], schema: Schema): Promise<{ data: Record<string, unknown>; usage: Usage }> {
  const thinking = thinkingConfig(cfg.model);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0, responseMimeType: "application/json", responseSchema: schema,
        ...(thinking ? { thinkingConfig: thinking } : {}),
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // 잘못된 키는 400으로 온다
    if (response.status === 401 || response.status === 403 || /API_KEY_INVALID|API key not valid/i.test(detail)) {
      throw new AssessmentApiError("Gemini API 키가 유효하지 않거나 권한이 없습니다. \"내 API 키\"에서 다시 넣어 주세요.", 403);
    }
    if (response.status === 429) throw new AssessmentApiError("Gemini 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", 429);
    if (response.status === 404) throw new AssessmentApiError(`Gemini 모델 '${cfg.model}'을 찾을 수 없습니다.`, 502);
    throw new AssessmentApiError("Gemini 요청에 실패했습니다.", 502);
  }
  const payload = await response.json();
  const outParts = (payload?.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string; thought?: boolean }>;
  const text = outParts.filter(p => !p.thought && typeof p.text === "string").map(p => p.text).join("");
  if (!text) throw new AssessmentApiError("Gemini가 빈 응답을 반환했습니다.", 502);
  const meta = payload?.usageMetadata ?? {};
  const usage: Usage = {
    input: Number(meta.promptTokenCount) || 0,
    output: Number(meta.candidatesTokenCount) || 0,
    thoughts: Number(meta.thoughtsTokenCount) || 0,
  };
  try {
    return { data: JSON.parse(text) as Record<string, unknown>, usage };
  } catch {
    throw new AssessmentApiError("Gemini 응답을 해석하지 못했습니다.", 502);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  const reason = error instanceof AssessmentApiError ? error : new AssessmentApiError("요청을 처리하지 못했습니다.");
  return Response.json({ error: reason.message }, { status: reason.status });
}

export type OcrItemSpec = { no: string; kind: string; choices: number; ox: number; hint: string };
const KINDS = new Set(["선택형", "복수선택", "기호", "OX", "단답", "서술"]);

export function validateSpecs(value: unknown): OcrItemSpec[] {
  if (!Array.isArray(value) || !value.length || value.length > 40) throw new AssessmentApiError("문항 정보가 올바르지 않습니다.", 400);
  return value.map(v => {
    const s = v as OcrItemSpec;
    if (typeof s.no !== "string" || s.no.length > 8 || !KINDS.has(s.kind)) throw new AssessmentApiError("문항 정보가 올바르지 않습니다.", 400);
    const hint = typeof s.hint === "string" ? s.hint.replace(/[\r\n]+/g, " ").slice(0, 120) : "";
    return { no: s.no, kind: s.kind, choices: Math.min(20, Math.max(0, Number(s.choices) || 0)), ox: Math.min(20, Math.max(0, Number(s.ox) || 0)), hint };
  });
}

function itemLine(s: OcrItemSpec) {
  const extra: Record<string, string> = {
    선택형: s.choices ? `보기 ${s.choices}개 중 하나` : "보기 번호 하나",
    복수선택: "보기 번호 여러 개",
    기호: "㉠, (가) 같은 기호",
    OX: `○/× ${s.ox}칸`,
    단답: "낱말이나 짧은 구",
    서술: "문장",
  };
  return `- ${s.no}: ${s.kind} (${extra[s.kind]})${s.hint ? ` — 위치: ${s.hint}` : ""}`;
}

export function readPrompt(specs: OcrItemSpec[], pageCount: number) {
  return `이 이미지 ${pageCount}장은 초등학생 한 명의 시험지 1~${pageCount}쪽입니다. 아래 문항에 학생이 직접 쓰거나 표시한 답을 보이는 그대로 옮겨 적으세요.
- 문항이 어느 쪽에 있든 찾아서 답합니다. 한 문항이 두 쪽에 걸쳐 있으면 학생이 표시한 곳을 따릅니다.
- 채점하거나 맞춤법을 고치지 마세요. 틀린 답도 그대로 적습니다.
- 절대 문제를 직접 풀어서 채우지 마세요. 학생이 비워 둔 칸은 반드시 빈 문자열입니다.
- "위치"는 그 칸이 시험지의 어디인지 알려 줄 뿐 정답이 아닙니다. 그 칸에 학생이 쓴 것만 적습니다.
- ( 가 / 나 ) 처럼 고르는 칸은 학생이 ○표 하거나 표시한 낱말 하나만 적습니다. 표시가 없으면 빈 문자열입니다.
- 인쇄된 문제 글과 보기는 답이 아닙니다. 학생이 동그라미 친 보기 번호는 ③처럼 적습니다.
- ○/× 문항은 칸 순서대로 '○,○,×'처럼 적습니다.
- 답이 없으면 빈 문자열, 읽기 어려우면 가장 그럴듯한 판독을 적고 confidence를 0.5 이하로 적습니다.
- 검게 가려진 부분은 무시하세요.
- 학생이 답에 실제 사람 이름(자기나 친구 이름)을 썼으면 그 이름만 [이름]으로 바꿔 적으세요. 문제에 인쇄된 이름은 그대로 둡니다.
- 한 문항에 빈칸이 여러 개면 "번호-칸" 문항(예: 6-1, 6-2)으로 나뉘어 있으니 해당 칸의 답만 적습니다.
문항:
${specs.map(itemLine).join("\n")}`;
}

export function gradePrompt(no: string, points: number, rubric: string, answer: string) {
  return `초등학교 서술형 문항을 채점 기준에 따라 채점하세요. 최종 점수는 교사가 확정합니다.
문항 ${no}번 (배점 ${points}점)
채점 기준: ${rubric}
학생 답: "${answer.replaceAll('"', "'")}"
- score는 0 이상 ${points} 이하의 숫자입니다.
- evidence에는 판단 근거가 된 학생 답의 구절을 그대로 인용하세요. 근거가 없으면 빈 문자열입니다.
- reason에는 한 문장으로 이유를 적습니다.`;
}

/** 문항 번호를 목록의 값으로만 쓰게 강제한다 (6-1번, 6(1) 같은 변형이 나오면 답을 잃는다) */
export function readSchema(itemNos: string[]) {
  return {
    type: "OBJECT",
    properties: {
      answers: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { item: { type: "STRING", enum: itemNos }, answer: { type: "STRING" }, confidence: { type: "NUMBER" } },
          required: ["item", "answer", "confidence"],
        },
      },
    },
    required: ["answers"],
  };
}

/** 모델이 적은 문항 번호를 목록의 번호로 맞춘다: "6-1번", "6(1)", "6 - 1", "l3" → "6-1", "L3" */
export function normalizeItemNo(raw: unknown, known: Set<string>) {
  const s = String(raw ?? "").trim();
  if (known.has(s)) return s;
  const cleaned = s
    .replace(/^문항\s*/, "")
    .replace(/번$/, "")
    .replace(/\s+/g, "")
    .replace(/^(\w+?)[(.]\s*(\d+)\)?$/, "$1-$2")
    .toUpperCase();
  return known.has(cleaned) ? cleaned : null;
}

export const GRADE_SCHEMA = {
  type: "OBJECT",
  properties: { score: { type: "NUMBER" }, evidence: { type: "STRING" }, reason: { type: "STRING" } },
  required: ["score", "evidence", "reason"],
};
