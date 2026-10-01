import { AuthError, encrypt, requireTeacher, tail, teacherKeys } from "../../../lib/server/auth";
import { getDb } from "../../../lib/server/db";

// 선생님이 자기 API 키를 넣는다. 저장 전에 실제로 쓸 수 있는 키인지 가볍게 확인한다(요금이 들지 않는 모델 목록 조회).
async function checkGemini(key: string) {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new AuthError("Gemini API 키가 올바르지 않습니다. Google AI Studio에서 키를 다시 확인해 주세요.", 400);
}
async function checkAnthropic(key: string) {
  const r = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new AuthError("Anthropic API 키가 올바르지 않습니다. console.anthropic.com에서 키를 다시 확인해 주세요.", 400);
}

export async function POST(request: Request) {
  try {
    const t = await requireTeacher(request);
    const body = (await request.json()) as { gemini?: string; geminiPaid?: boolean; anthropic?: string; clear?: "gemini" | "anthropic" };
    const db = await getDb();
    await db.query("INSERT INTO teacher_keys (teacher_id) VALUES ($1) ON CONFLICT (teacher_id) DO NOTHING", [t.id]);
    if (body.clear === "gemini") await db.query("UPDATE teacher_keys SET gemini_enc = NULL, gemini_paid = false, updated_at = now() WHERE teacher_id = $1", [t.id]);
    if (body.clear === "anthropic") await db.query("UPDATE teacher_keys SET anthropic_enc = NULL, updated_at = now() WHERE teacher_id = $1", [t.id]);
    const gemini = body.gemini?.trim();
    if (gemini) {
      if (gemini.length > 200) throw new AuthError("키가 너무 깁니다.", 400);
      await checkGemini(gemini);
      await db.query("UPDATE teacher_keys SET gemini_enc = $2, updated_at = now() WHERE teacher_id = $1", [t.id, encrypt(gemini)]);
    }
    if (typeof body.geminiPaid === "boolean") await db.query("UPDATE teacher_keys SET gemini_paid = $2, updated_at = now() WHERE teacher_id = $1", [t.id, body.geminiPaid]);
    const anthropic = body.anthropic?.trim();
    if (anthropic) {
      if (anthropic.length > 300) throw new AuthError("키가 너무 깁니다.", 400);
      await checkAnthropic(anthropic);
      await db.query("UPDATE teacher_keys SET anthropic_enc = $2, updated_at = now() WHERE teacher_id = $1", [t.id, encrypt(anthropic)]);
    }
    const k = await teacherKeys(t.id);
    return Response.json({ gemini: tail(k.gemini), geminiPaid: k.geminiPaid, anthropic: tail(k.anthropic) });
  } catch (e) {
    return Response.json({ error: e instanceof AuthError ? e.message : "키를 저장하지 못했습니다." }, { status: e instanceof AuthError ? e.status : 500 });
  }
}
