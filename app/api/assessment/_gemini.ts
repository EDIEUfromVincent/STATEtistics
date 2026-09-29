// 채점용 Gemini 중계. 서버가 받는 것은 이름 칸을 가린 페이지 이미지와 이름을 가린 서술형 텍스트뿐이다.
// 이미지·텍스트는 저장하지 않고, 로그에는 해시와 크기만 남긴다.

export class AssessmentApiError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "AssessmentApiError";
    this.status = status;
  }
}

export function geminiConfig() {
  return {
    apiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
    model: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
    // 무료 등급은 입력 데이터가 제품 개선에 쓰일 수 있어 학생 자료에 쓰지 않는다
    paidTier: process.env.GEMINI_PAID_TIER?.trim().toLowerCase() === "true",
    accessKeySet: Boolean(process.env.STATETISTIC_ACCESS_KEY?.trim()),
    // 요금표 기준 추정용 (USD per 1M tokens). 실제 청구액은 Google Cloud 결제 화면이 기준이다
    priceInputPerM: Number(process.env.GEMINI_PRICE_INPUT_PER_M) || 0.3,
    priceOutputPerM: Number(process.env.GEMINI_PRICE_OUTPUT_PER_M) || 2.5,
    usdKrw: Number(process.env.USD_KRW) || 1400,
  };
}

/**
 * 글씨를 옮겨 적는 일에는 '생각' 토큰이 필요 없다. 생각 토큰은 출력 요금으로 청구되므로 끈다.
 * gemini-2.5 flash 계열은 thinkingBudget 0으로 끌 수 있다(2.5 pro는 끌 수 없음).
 * 다른 모델은 GEMINI_THINKING_BUDGET으로 직접 정한다.
 */
function thinkingConfig(model: string) {
  const env = process.env.GEMINI_THINKING_BUDGET?.trim();
  if (env) return { thinkingBudget: Number(env) };
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  return undefined;
}

/** 학생 자료를 다루므로 접속 코드가 설정되지 않았으면 열어 두지 않는다 (fail closed). */
export function assertReady(request: Request) {
  const cfg = geminiConfig();
  if (!cfg.accessKeySet) throw new AssessmentApiError("Railway에 STATETISTIC_ACCESS_KEY(접속 코드)를 먼저 설정해 주세요.", 503);
  if (!cfg.apiKey) throw new AssessmentApiError("Railway에 GEMINI_API_KEY를 설정해 주세요.", 503);
  if (!cfg.paidTier) {
    throw new AssessmentApiError("학생 자료는 Gemini 유료 등급에서만 처리합니다. 유료 등급 키라면 Railway에 GEMINI_PAID_TIER=true를 설정해 주세요.", 503);
  }
  const expected = process.env.STATETISTIC_ACCESS_KEY!.trim();
  const provided = request.headers.get("x-statetistic-access-key")?.trim() ?? "";
  let difference = provided.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ (provided.charCodeAt(i) || 0);
  if (difference !== 0) throw new AssessmentApiError("접속 코드가 올바르지 않습니다.", 401);
  rateLimit(request);
  return cfg;
}

const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60_000;
const MAX_REQUESTS = 300; // 학생 1명당 판독 1번 + 서술형 여유 (여러 반을 연달아 채점해도 넉넉하게)

function rateLimit(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) throw new AssessmentApiError("요청이 너무 많습니다. 10분 뒤에 다시 시도해 주세요.", 429);
  recent.push(now);
  hits.set(ip, recent);
}

export async function audit(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event, time: new Date().toISOString(), ...fields }));
}

export async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

type Schema = Record<string, unknown>;
export type Usage = { input: number; output: number; thoughts: number };

export async function callGemini(cfg: ReturnType<typeof geminiConfig>, parts: unknown[], schema: Schema): Promise<{ data: Record<string, unknown>; usage: Usage }> {
  const thinking = thinkingConfig(cfg.model);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0, responseMimeType: "application/json", responseSchema: schema,
        ...(thinking ? { thinkingConfig: thinking } : {}),
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // 잘못된 키는 400으로 온다
    if (response.status === 401 || response.status === 403 || /API_KEY_INVALID|API key not valid/i.test(detail)) {
      throw new AssessmentApiError("GEMINI_API_KEY가 유효하지 않거나 권한이 없습니다. Railway 변수를 확인해 주세요.", 503);
    }
    if (response.status === 429) throw new AssessmentApiError("Gemini 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", 429);
    if (response.status === 404) throw new AssessmentApiError(`Gemini 모델 '${cfg.model}'을 찾을 수 없습니다. GEMINI_MODEL을 확인해 주세요.`, 503);
    throw new AssessmentApiError("Gemini 요청에 실패했습니다.", 502);
  }
  const payload = await response.json();
  const outParts = (payload?.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string; thought?: boolean }>;
  const text = outParts.filter(p => !p.thought && typeof p.text === "string").map(p => p.text).join("");
  if (!text) throw new AssessmentApiError("Gemini가 빈 응답을 반환했습니다.", 502);
  const meta = payload?.usageMetadata ?? {};
  const usage: Usage = {
    input: Number(meta.promptTokenCount) || 0,
    output: Number(meta.candidatesTokenCount) || 0,
    thoughts: Number(meta.thoughtsTokenCount) || 0,
  };
  try {
    return { data: JSON.parse(text) as Record<string, unknown>, usage };
  } catch {
    throw new AssessmentApiError("Gemini 응답을 해석하지 못했습니다.", 502);
  }
}

export function errorResponse(error: unknown) {
  const reason = error instanceof AssessmentApiError ? error : new AssessmentApiError("요청을 처리하지 못했습니다.");
  return Response.json({ error: reason.message }, { status: reason.status });
}

export type OcrItemSpec = { no: string; kind: string; choices: number; ox: number };
const KINDS = new Set(["선택형", "복수선택", "기호", "OX", "단답", "서술"]);

export function validateSpecs(value: unknown): OcrItemSpec[] {
  if (!Array.isArray(value) || !value.length || value.length > 40) throw new AssessmentApiError("문항 정보가 올바르지 않습니다.", 400);
  return value.map(v => {
    const s = v as OcrItemSpec;
    if (typeof s.no !== "string" || s.no.length > 8 || !KINDS.has(s.kind)) throw new AssessmentApiError("문항 정보가 올바르지 않습니다.", 400);
    return { no: s.no, kind: s.kind, choices: Math.min(20, Math.max(0, Number(s.choices) || 0)), ox: Math.min(20, Math.max(0, Number(s.ox) || 0)) };
  });
}

function itemLine(s: OcrItemSpec) {
  const extra: Record<string, string> = {
    선택형: s.choices ? `보기 ${s.choices}개 중 하나` : "보기 번호 하나",
    복수선택: "보기 번호 여러 개",
    기호: "㉠, (가) 같은 기호",
    OX: `○/× ${s.ox}칸`,
    단답: "낱말이나 짧은 구",
    서술: "문장",
  };
  return `- ${s.no}번: ${s.kind} (${extra[s.kind]})`;
}

export function readPrompt(specs: OcrItemSpec[], pageCount: number) {
  return `이 이미지 ${pageCount}장은 초등학생 한 명의 시험지 1~${pageCount}쪽입니다. 아래 문항에 학생이 직접 쓰거나 표시한 답을 보이는 그대로 옮겨 적으세요.
- 문항이 어느 쪽에 있든 찾아서 답합니다. 한 문항이 두 쪽에 걸쳐 있으면 학생이 표시한 곳을 따릅니다.
- 채점하거나 맞춤법을 고치지 마세요. 틀린 답도 그대로 적습니다.
- 인쇄된 문제 글과 보기는 답이 아닙니다. 학생이 동그라미 친 보기 번호는 ③처럼 적습니다.
- ○/× 문항은 칸 순서대로 '○,○,×'처럼 적습니다.
- 답이 없으면 빈 문자열, 읽기 어려우면 가장 그럴듯한 판독을 적고 confidence를 0.5 이하로 적습니다.
- 검게 가려진 부분은 무시하세요.
문항:
${specs.map(itemLine).join("\n")}`;
}

export function gradePrompt(no: string, points: number, rubric: string, answer: string) {
  return `초등학교 서술형 문항을 채점 기준에 따라 채점하세요. 최종 점수는 교사가 확정합니다.
문항 ${no}번 (배점 ${points}점)
채점 기준: ${rubric}
학생 답: "${answer.replaceAll('"', "'")}"
- score는 0 이상 ${points} 이하의 숫자입니다.
- evidence에는 판단 근거가 된 학생 답의 구절을 그대로 인용하세요. 근거가 없으면 빈 문자열입니다.
- reason에는 한 문장으로 이유를 적습니다.`;
}

export const READ_SCHEMA = {
  type: "OBJECT",
  properties: {
    answers: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { item: { type: "STRING" }, answer: { type: "STRING" }, confidence: { type: "NUMBER" } },
        required: ["item", "answer", "confidence"],
      },
    },
  },
  required: ["answers"],
};

export const GRADE_SCHEMA = {
  type: "OBJECT",
  properties: { score: { type: "NUMBER" }, evidence: { type: "STRING" }, reason: { type: "STRING" } },
  required: ["score", "evidence", "reason"],
};
