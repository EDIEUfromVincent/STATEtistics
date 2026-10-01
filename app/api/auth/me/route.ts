import { currentTeacher, tail, teacherKeys } from "../../../lib/server/auth";

// 로그인에 필요한 서버 변수 중 빠진 것의 이름 (값은 절대 내보내지 않는다)
function loginMissing() {
  const missing: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID?.trim()) missing.push("GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET?.trim()) missing.push("GOOGLE_CLIENT_SECRET");
  const secret = process.env.AUTH_SECRET?.trim() ?? "";
  if (secret.length < 32) missing.push(secret ? "AUTH_SECRET(32자 이상)" : "AUTH_SECRET");
  return missing;
}

// 로그인한 선생님과 API 키 상태 (키는 끝 네 자리만)
export async function GET(request: Request) {
  try {
    const t = await currentTeacher(request);
    if (!t) {
      const missing = loginMissing();
      return Response.json({ teacher: null, loginReady: missing.length === 0, loginMissing: missing });
    }
    const k = await teacherKeys(t.id);
    return Response.json({ teacher: { email: t.email, name: t.name }, keys: { gemini: tail(k.gemini), geminiPaid: k.geminiPaid, geminiModel: k.geminiModel, anthropic: tail(k.anthropic) }, loginReady: true });
  } catch (e) {
    // 데이터베이스 연결 오류 문구에는 주소가 섞일 수 있어 내보내지 않는다
    console.error("auth/me", e);
    const missing = loginMissing();
    return Response.json({ teacher: null, loginReady: false, loginMissing: missing.length ? missing : ["DATABASE_URL(데이터베이스 연결 실패)"] }, { status: 200 });
  }
}
