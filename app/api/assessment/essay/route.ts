import { AssessmentApiError, assertReady, audit, callGemini, errorResponse, GRADE_SCHEMA, gradePrompt } from "../_gemini";

// 서술형 1차 채점 제안. 두 번 채점해서 다르면 표시한다. 점수 확정은 교사가 브라우저에서 한다.
export async function POST(request: Request) {
  try {
    const cfg = assertReady(request);
    const body = (await request.json()) as { no?: unknown; points?: unknown; rubric?: unknown; answer?: unknown };
    const no = typeof body.no === "string" ? body.no.slice(0, 8) : "";
    const points = Number(body.points);
    const rubric = typeof body.rubric === "string" ? body.rubric.slice(0, 2000) : "";
    const answer = typeof body.answer === "string" ? body.answer.slice(0, 2000) : "";
    if (!no || !Number.isFinite(points) || points <= 0 || points > 100 || !rubric || !answer) {
      throw new AssessmentApiError("채점 요청 정보가 올바르지 않습니다.", 400);
    }
    await audit("assessment_essay", { item: no, chars: answer.length, model: cfg.model });

    const prompt = [{ text: gradePrompt(no, points, rubric, answer) }];
    const [first, second] = await Promise.all([callGemini(cfg, prompt, GRADE_SCHEMA), callGemini(cfg, prompt, GRADE_SCHEMA)]);
    const clamp = (v: unknown) => Math.max(0, Math.min(points, Number(v) || 0));
    return Response.json({
      score: clamp(first.score),
      evidence: typeof first.evidence === "string" ? first.evidence.slice(0, 500) : "",
      reason: typeof first.reason === "string" ? first.reason.slice(0, 500) : "",
      unstable: clamp(first.score) !== clamp(second.score),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
