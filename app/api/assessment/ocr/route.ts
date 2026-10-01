import {
  AssessmentApiError,
  assertReady,
  audit,
  callGemini,
  errorResponse,
  normalizeItemNo,
  readPrompt,
  readSchema,
  sha256,
  validateSpecs,
} from "../_gemini";

const MAX_PAGES = 8;
const MAX_BASE64 = 6_000_000; // 쪽당 약 4.5MB JPEG

// 학생 한 명의 모든 쪽을 요청 한 번에 판독한다. 쪽마다 따로 보내면 같은 안내문이 쪽 수만큼 청구된다.
export async function POST(request: Request) {
  try {
    const cfg = assertReady(request);
    const body = (await request.json()) as { images?: unknown; items?: unknown };
    if (!Array.isArray(body.images) || !body.images.length || body.images.length > MAX_PAGES) {
      throw new AssessmentApiError(`학생 한 명당 1~${MAX_PAGES}쪽을 보내야 합니다.`, 400);
    }
    const images = body.images.map(image => {
      if (typeof image !== "string" || !image || image.length > MAX_BASE64) throw new AssessmentApiError("이미지가 없거나 너무 큽니다.", 400);
      const bytes = Uint8Array.from(atob(image), c => c.charCodeAt(0));
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new AssessmentApiError("브라우저에서 가림 처리한 JPEG만 받습니다.", 400);
      return { base64: image, bytes };
    });
    const specs = validateSpecs(body.items);

    const { data, usage } = await callGemini(
      cfg,
      [{ text: readPrompt(specs, images.length) }, ...images.map(i => ({ inlineData: { mimeType: "image/jpeg", data: i.base64 } }))],
      readSchema(specs.map(s => s.no)),
    );
    const known = new Set(specs.map(s => s.no));
    const got = new Map<string, Record<string, unknown>>();
    const unmatched: string[] = [];
    for (const a of (Array.isArray(data.answers) ? data.answers : []) as Array<Record<string, unknown>>) {
      const no = normalizeItemNo(a.item, known);
      if (no) got.set(no, a);
      else unmatched.push(String(a.item ?? "").slice(0, 12));
    }
    await audit("assessment_ocr", {
      pages: images.length, sha256: await Promise.all(images.map(i => sha256(i.bytes))),
      bytes: images.reduce((s, i) => s + i.bytes.length, 0), items: specs.length, matched: got.size, unmatched, model: cfg.model, usage,
    });

    return Response.json({
      answers: specs.map(s => {
        const a = got.get(s.no) as Record<string, unknown> | undefined;
        return {
          no: s.no,
          answer: typeof a?.answer === "string" ? a.answer.slice(0, 1000) : "",
          // 모델이 문항을 빠뜨리면 확신도 0 → 교사 확인으로 간다
          confidence: a ? Math.max(0, Math.min(1, Number(a.confidence) || 0)) : 0,
        };
      }),
      usage,
      matched: got.size,
      unmatched, // 문항 번호만 (답 내용은 없음) — 번호 형식 문제를 진단할 때 쓴다
    });
  } catch (error) {
    return errorResponse(error);
  }
}
