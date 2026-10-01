import { currentTeacher, tail, teacherKeys } from "../../../lib/server/auth";

// 로그인한 선생님과 API 키 상태 (키는 끝 네 자리만)
export async function GET(request: Request) {
  try {
    const t = await currentTeacher(request);
    if (!t) return Response.json({ teacher: null, loginReady: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET) });
    const k = await teacherKeys(t.id);
    return Response.json({ teacher: { email: t.email, name: t.name }, keys: { gemini: tail(k.gemini), geminiPaid: k.geminiPaid, geminiModel: k.geminiModel, anthropic: tail(k.anthropic) }, loginReady: true });
  } catch (e) {
    return Response.json({ teacher: null, loginReady: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
