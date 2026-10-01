import Anthropic from "@anthropic-ai/sdk";
import type { TeacherKeys } from "../../../lib/server/auth";
import { AssessmentApiError, audit, callGemini, errorResponse, needGemini, sha256, teacherContext } from "../_gemini";
import { readerConfig } from "../_readers";

// 학생 답안 1쪽 머리글에서 "반·번호" 부분만 잘라 낸 조각(이름은 잘라 냄)의 손글씨 숫자를 읽는다.
// 스캔이 번호 순서가 아니어도 학생을 맞추기 위해서다. 받는 것은 숫자 칸 조각뿐이다.

const MAX = 80;
const MAX_BASE64 = 400_000;

export async function POST(request: Request) {
  try {
    const { keys } = await teacherContext(request);
    const cfg = needGemini(keys);
    const body = (await request.json()) as { crops?: unknown };
    if (!Array.isArray(body.crops) || !body.crops.length || body.crops.length > MAX) throw new AssessmentApiError(`조각은 1~${MAX}개를 보내야 합니다.`, 400);
    const crops = body.crops.map(v => {
      const c = v as { id?: unknown; image?: unknown };
      if (typeof c.id !== "string" || !/^G\d{1,3}$/.test(c.id) || typeof c.image !== "string" || c.image.length > MAX_BASE64 || !c.image.startsWith("iVBORw0KGgo")) {
        throw new AssessmentApiError("번호 칸 조각(PNG)만 받습니다.", 400);
      }
      return { id: c.id, image: c.image };
    });
    const parts: unknown[] = [{ text: `이미지마다 초등학교 시험지 머리글의 "○학년 ○반 ○번" 부분입니다. 학생이 손으로 쓴 반과 번호의 숫자만 읽으세요.
- 인쇄된 글자(학년, 반, 번)는 답이 아닙니다. 빈칸에 손으로 쓴 숫자만 봅니다.
- 숫자가 비었거나 읽을 수 없으면 null로 둡니다. 추측하지 마세요.
- 다른 숫자로도 읽힐 수 있으면(예: 3과 7, 1과 7, 6과 0) 확실을 false로 합니다.
- 이미지마다 id, 반, 번호, 확실을 적으세요.` }];
    for (const c of crops) {
      parts.push({ text: `id ${c.id}` });
      parts.push({ inlineData: { mimeType: "image/png", data: c.image } });
    }
    const schema = {
      type: "OBJECT",
      properties: {
        rows: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { id: { type: "STRING", enum: crops.map(c => c.id) }, 반: { type: "INTEGER", nullable: true }, 번호: { type: "INTEGER", nullable: true }, 확실: { type: "BOOLEAN" } },
            required: ["id", "반", "번호", "확실"],
          },
        },
      },
      required: ["rows"],
    };
    const model = process.env.GEMINI_READER_MODEL?.trim() || "gemini-3.8-flash";
    const { data, usage } = await callGemini({ ...cfg, model }, parts, schema);
    const rows = (Array.isArray(data.rows) ? data.rows : []) as Array<{ id: string; 반: number | null; 번호: number | null; 확실?: boolean }>;
    // 모델이 스스로 매긴 "확실"은 믿기 어렵다(3/7을 확실하다고 함) → 확인 판독기가 있으면 다른 계열로 한 번 더 읽어 다르면 애매로 표시
    const second = await readNumbersWithClaude(crops, keys).catch(() => null);
    await audit("assessment_numbers", {
      crops: crops.length, model, usage,
      sha256: await Promise.all(crops.map(c => sha256(Uint8Array.from(atob(c.image), ch => ch.charCodeAt(0))))),
    });
    const usd = (usage.input * cfg.priceInputPerM + (usage.output + usage.thoughts) * cfg.priceOutputPerM) / 1e6;
    return Response.json({
      rows: rows.map(r => {
        const number = Number.isInteger(r.번호) ? r.번호 : null;
        const other = second?.get(r.id);
        return { id: r.id, ban: Number.isInteger(r.반) ? r.반 : null, number, sure: r.확실 !== false && (second == null || other === number) };
      }),
      usd: usd + (second?.usd ?? 0),
      checkedBy: second ? readerConfig(keys).verifyModel : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** 확인 판독기(CELL_VERIFIER_MODEL, 예: claude-sonnet-5-5)로 번호만 다시 읽는다. 없으면 null */
async function readNumbersWithClaude(crops: Array<{ id: string; image: string }>, keys: TeacherKeys) {
  const cfg = readerConfig(keys);
  if (!cfg.verifyModel || !cfg.claudeReady) return null;
  const client = new Anthropic({ apiKey: keys.anthropic });
  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: "이미지마다 시험지 머리글의 \"○학년 ○반 ○번\" 부분입니다. 학생이 손으로 쓴 번호(반 다음 칸)의 숫자만 읽으세요. 비었거나 읽을 수 없으면 null." }];
  for (const c of crops) {
    content.push({ type: "text", text: `id ${c.id}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: c.image } });
  }
  const schema = {
    type: "object",
    properties: { rows: { type: "array", items: { type: "object", properties: { id: { type: "string", enum: crops.map(c => c.id) }, number: { type: ["integer", "null"] } }, required: ["id", "number"], additionalProperties: false } } },
    required: ["rows"], additionalProperties: false,
  };
  const r = await client.messages.create({ model: cfg.verifyModel, max_tokens: 4000, output_config: { effort: "low", format: { type: "json_schema", schema } }, messages: [{ role: "user", content }] });
  if (r.stop_reason !== "end_turn") return null;
  const text = r.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("");
  const out = new Map<string, number | null>(((JSON.parse(text).rows ?? []) as Array<{ id: string; number: number | null }>).map(x => [x.id, x.number]));
  const price = cfg.verifyModel.includes("opus") ? [4, 20] : [2, 10];
  return Object.assign(out, { usd: (r.usage.input_tokens * price[0] + r.usage.output_tokens * price[1]) / 1e6 });
}
