import { AuthError, googleCallback } from "../../../../lib/server/auth";

export async function GET(request: Request) {
  try {
    return await googleCallback(request);
  } catch (e) {
    const message = e instanceof AuthError ? e.message : "구글 로그인에 실패했습니다.";
    console.error(JSON.stringify({ event: "auth_callback_error", message: e instanceof Error ? e.message : String(e) }));
    return new Response(null, { status: 302, headers: { Location: `/grading?login_error=${encodeURIComponent(message)}` } });
  }
}
