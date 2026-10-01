import { AuthError, googleStart } from "../../../lib/server/auth";

// 구글 로그인 시작: /api/auth/google?next=/grading
export async function GET(request: Request) {
  try {
    return googleStart(request, new URL(request.url).searchParams.get("next") ?? "/grading");
  } catch (e) {
    return Response.json({ error: e instanceof AuthError ? e.message : "로그인을 시작하지 못했습니다." }, { status: e instanceof AuthError ? e.status : 500 });
  }
}
