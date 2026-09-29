import { AssessmentApiError, assertReady, audit, callGemini, errorResponse, GRADE_SCHEMA, gradePrompt } from "../_gemini";

// 서술형 1차 채점 제안. 호출은 한 번만 한다. 일관성 확인은 교사가 "재확인"을 누를 때
// 브라우저가 한 번 더 요청해 앞의 점수와 비교한다. 점수 확정은 교사가 한다.
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
    const { data, usage } = await callGemini(cfg, [{ text: gradePrompt(no, points, rubric, answer) }], GRADE_SCHEMA);
    await audit("assessment_essay", { item: no, chars: answer.length, model: cfg.model, usage });
    return Response.json({
      score: Math.max(0, Math.min(points, Number(data.score) || 0)),
      evidence: typeof data.evidence === "string" ? data.evidence.slice(0, 500) : "",
      reason: typeof data.reason === "string" ? data.reason.slice(0, 500) : "",
      usage,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
