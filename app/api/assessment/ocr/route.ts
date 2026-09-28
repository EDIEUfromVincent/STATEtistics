import {
  AssessmentApiError,
  assertReady,
  audit,
  callGemini,
  errorResponse,
  READ_SCHEMA,
  readPrompt,
  sha256,
  validateSpecs,
} from "../_gemini";

const MAX_BASE64 = 6_000_000; // 약 4.5MB JPEG

export async function POST(request: Request) {
  try {
    const cfg = assertReady(request);
    const body = (await request.json()) as { image?: unknown; items?: unknown };
    if (typeof body.image !== "string" || !body.image || body.image.length > MAX_BASE64) {
      throw new AssessmentApiError("이미지가 없거나 너무 큽니다.", 400);
    }
    const bytes = Uint8Array.from(atob(body.image), c => c.charCodeAt(0));
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new AssessmentApiError("브라우저에서 가림 처리한 JPEG만 받습니다.", 400);
    }
    const specs = validateSpecs(body.items);
    await audit("assessment_ocr", { sha256: await sha256(bytes), bytes: bytes.length, items: specs.length, model: cfg.model });

    const out = await callGemini(cfg, [{ text: readPrompt(specs) }, { inlineData: { mimeType: "image/jpeg", data: body.image } }], READ_SCHEMA);
    const got = new Map(
      (Array.isArray(out.answers) ? out.answers : []).map((a: Record<string, unknown>) => [String(a.item ?? "").trim(), a]),
    );
    return Response.json({
      answers: specs.map(s => {
        const a = got.get(s.no) as Record<string, unknown> | undefined;
        return {
          no: s.no,
          answer: typeof a?.answer === "string" ? a.answer.slice(0, 1000) : "",
          confidence: Math.max(0, Math.min(1, Number(a?.confidence) || 0)),
        };
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
