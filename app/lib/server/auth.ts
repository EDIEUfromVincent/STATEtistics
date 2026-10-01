// 구글 로그인, 로그인 쿠키, 선생님 API 키 암호화.
// 누구나 구글 계정으로 로그인하면 자기 공간이 생긴다. 판독 요금은 각 선생님이 넣은 자기 API 키로 나간다.

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "./db.ts";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

const SESSION = "st_session";
const STATE = "st_oauth_state";
const DAYS = 30;

function secret() {
  const s = process.env.AUTH_SECRET?.trim();
  if (!s || s.length < 32) throw new AuthError("서버에 AUTH_SECRET(32자 이상 무작위 문자열)을 설정해 주세요.", 503);
  return s;
}

const b64url = (b: Buffer) => b.toString("base64url");

export function cookieOf(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return "";
}

/** Railway 같은 프록시 뒤에서는 x-forwarded-* 로 실제 주소를 안다 */
export function originOf(request: Request) {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

const secure = (request: Request) => originOf(request).startsWith("https://");
const cookie = (request: Request, name: string, value: string, maxAge: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(request) ? "; Secure" : ""}`;

// ---- 로그인 쿠키 (선생님 id + 만료, HMAC 서명) ----
function sign(payload: string) {
  return b64url(createHmac("sha256", secret()).update(payload).digest());
}

export function sessionCookie(request: Request, teacherId: number) {
  const payload = b64url(Buffer.from(JSON.stringify({ t: teacherId, exp: Date.now() + DAYS * 864e5 })));
  return cookie(request, SESSION, `${payload}.${sign(payload)}`, DAYS * 86400);
}

export const clearSessionCookie = (request: Request) => cookie(request, SESSION, "", 0);

export type Teacher = { id: number; email: string; name: string };

export async function currentTeacher(request: Request): Promise<Teacher | null> {
  const raw = cookieOf(request, SESSION);
  const [payload, mac] = raw.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const { t, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { t: number; exp: number };
  if (!t || exp < Date.now()) return null;
  const db = await getDb();
  const rows = await db.query<Teacher>("SELECT id, email, name FROM teachers WHERE id = $1", [t]);
  return rows[0] ?? null;
}

export async function requireTeacher(request: Request) {
  const t = await currentTeacher(request);
  if (!t) throw new AuthError("구글로 로그인해 주세요.", 401);
  return t;
}

// ---- 구글 로그인 ----
function google() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim(), sec = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!id || !sec) throw new AuthError("서버에 GOOGLE_CLIENT_ID와 GOOGLE_CLIENT_SECRET을 설정해 주세요.", 503);
  return { id, sec };
}

export function googleStart(request: Request, returnTo = "/grading") {
  const { id } = google();
  const state = b64url(randomBytes(24));
  const redirect = `${originOf(request)}/api/auth/google/callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: "code", scope: "openid email profile", state, prompt: "select_account" }).toString();
  const back = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/grading";
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": cookie(request, STATE, `${state}|${back}`, 600) } });
}

export async function googleCallback(request: Request) {
  const { id, sec } = google();
  const url = new URL(request.url);
  const [state, back] = cookieOf(request, STATE).split("|");
  if (!state || url.searchParams.get("state") !== state) throw new AuthError("로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.", 400);
  const code = url.searchParams.get("code");
  if (!code) throw new AuthError("구글 로그인이 취소되었습니다.", 400);
  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: id, client_secret: sec, redirect_uri: `${originOf(request)}/api/auth/google/callback`, grant_type: "authorization_code" }),
  }).then(r => r.json()) as { access_token?: string; error?: string };
  if (!token.access_token) throw new AuthError(`구글 로그인에 실패했습니다 (${token.error ?? "토큰 없음"}).`, 400);
  const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } }).then(r => r.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
  if (!info.sub || !info.email || info.email_verified === false) throw new AuthError("확인된 구글 이메일이 필요합니다.", 400);
  const db = await getDb();
  const rows = await db.query<{ id: number }>(
    `INSERT INTO teachers (google_sub, email, name) VALUES ($1, $2, $3)
     ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, last_login = now()
     RETURNING id`, [info.sub, info.email, info.name ?? ""]);
  const headers = new Headers({ Location: back || "/grading" });
  headers.append("Set-Cookie", sessionCookie(request, rows[0].id));
  headers.append("Set-Cookie", cookie(request, STATE, "", 0));
  return new Response(null, { status: 302, headers });
}

// ---- 선생님 API 키 (AES-256-GCM, 키는 AUTH_SECRET에서 만든다) ----
const encKey = () => createHash("sha256").update(`${secret()}:teacher-api-keys`).digest();

export function encrypt(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map(b64url).join(".");
}

export function decrypt(packed: string) {
  const [iv, tag, body] = packed.split(".").map(s => Buffer.from(s, "base64url"));
  const d = createDecipheriv("aes-256-gcm", encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

export type TeacherKeys = { gemini: string; geminiPaid: boolean; anthropic: string };

export async function teacherKeys(teacherId: number): Promise<TeacherKeys> {
  const db = await getDb();
  const r = (await db.query<{ gemini_enc: string | null; gemini_paid: boolean; anthropic_enc: string | null }>(
    "SELECT gemini_enc, gemini_paid, anthropic_enc FROM teacher_keys WHERE teacher_id = $1", [teacherId]))[0];
  const open = (v: string | null) => { try { return v ? decrypt(v) : ""; } catch { return ""; } };
  return { gemini: open(r?.gemini_enc ?? null), geminiPaid: Boolean(r?.gemini_paid), anthropic: open(r?.anthropic_enc ?? null) };
}

export const tail = (key: string) => (key ? `…${key.slice(-4)}` : "");
