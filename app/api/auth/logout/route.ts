import { clearSessionCookie } from "../../../lib/server/auth";

export async function POST(request: Request) {
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie(request) } });
}
