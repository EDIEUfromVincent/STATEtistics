import { AssessmentApiError, audit, errorResponse, geminiBody, geminiConfig, geminiFailure, parseGeminiPayload, sha256, teacherContext } from "../../_gemini";
import { parseSheetBody, readerConfig, readingsOf, sheetRequest } from "../../_readers";

// Gemini 일괄 처리(Batch): 요금이 바로 판독의 절반이고, 결과는 몇 분~최대 24시간 뒤에 나온다.
// POST: 학생 여러 명의 묶음 그림을 한 번에 맡기고 일괄 처리 이름을 돌려준다. GET ?name=: 상태를 보고, 끝났으면 학생별 판독을 돌려준다.
// 일괄 처리는 선생님의 Gemini 키(그 프로젝트) 안에만 있고, 이 서버는 아무것도 저장하지 않는다.

const MAX_STUDENTS = 40;
const BATCH_DISCOUNT = 0.5;
const API = "https://generativelanguage.googleapis.com/v1beta";

function ready(cfg: ReturnType<typeof readerConfig>) {
  if (cfg.provider !== "gemini" || !cfg.geminiReady) throw new AssessmentApiError("일괄 처리는 Gemini 유료 등급 키로만 합니다. \"내 API 키\"를 확인해 주세요.", 403);
}

export async function POST(request: Request) {
  try {
    const { keys } = await teacherContext(request);
    ready(readerConfig(keys));
    const gemini = geminiConfig(keys);
    const body = (await request.json()) as { students?: unknown };
    if (!Array.isArray(body.students) || !body.students.length || body.students.length > MAX_STUDENTS) throw new AssessmentApiError(`학생은 한 번에 1~${MAX_STUDENTS}명을 맡길 수 있습니다.`, 400);
    const keysSeen = new Set<string>();
    const requests = body.students.map(v => {
      const st = v as { key?: unknown; cells?: unknown; sheets?: unknown };
      if (typeof st.key !== "string" || !/^[A-Z0-9]{2,8}$/.test(st.key) || keysSeen.has(st.key)) throw new AssessmentApiError("학생 코드가 올바르지 않습니다.", 400);
      keysSeen.add(st.key);
      const { sheets, hints } = parseSheetBody(st);
      const { parts, schema } = sheetRequest(sheets, hints);
      return { key: st.key, sheets, request: geminiBody(gemini, parts, schema) };
    });
    const response = await fetch(`${API}/models/${encodeURIComponent(gemini.model)}:batchGenerateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": gemini.apiKey },
      body: JSON.stringify({
        batch: {
          display_name: `statetistic-${Date.now()}`,
          input_config: { requests: { requests: requests.map(r => ({ request: r.request, metadata: { key: r.key } })) } },
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) await geminiFailure(response, gemini.model);
    const created = (await response.json()) as { name?: string };
    if (!created.name) throw new AssessmentApiError("Gemini가 일괄 처리 이름을 돌려주지 않았습니다.", 502);
    await audit("assessment_cells_batch", {
      batch: created.name, students: requests.length, model: gemini.model,
      sha256: await Promise.all(requests.flatMap(r => r.sheets.map(s => sha256(Uint8Array.from(atob(s.image), ch => ch.charCodeAt(0)))))),
    });
    return Response.json({ name: created.name });
  } catch (error) {
    return errorResponse(error);
  }
}

type Inlined = { response?: unknown; error?: { message?: string } | null; metadata?: { key?: string } };

export async function GET(request: Request) {
  try {
    const { keys } = await teacherContext(request);
    ready(readerConfig(keys));
    const gemini = geminiConfig(keys);
    const name = new URL(request.url).searchParams.get("name") ?? "";
    if (!/^batches\/[\w-]{1,128}$/.test(name)) throw new AssessmentApiError("일괄 처리 이름이 올바르지 않습니다.", 400);
    const response = await fetch(`${API}/${name}`, { headers: { "x-goog-api-key": gemini.apiKey }, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) await geminiFailure(response, gemini.model);
    const job = (await response.json()) as Record<string, unknown>;
    // 상태 이름이 BATCH_STATE_* 또는 JOB_STATE_* 로 온다
    const meta = (job.metadata ?? {}) as Record<string, unknown>;
    const state = String(meta.state ?? job.state ?? "");
    if (/FAILED|CANCELLED|EXPIRED/.test(state)) return Response.json({ state: "failed", detail: state });
    if (!/SUCCEEDED/.test(state)) return Response.json({ state: /RUNNING/.test(state) ? "running" : "pending" });

    const holder = (job.response ?? meta.output ?? job.output ?? {}) as { inlinedResponses?: { inlinedResponses?: Inlined[] } | Inlined[] };
    const inlined: Inlined[] = Array.isArray(holder.inlinedResponses) ? holder.inlinedResponses : holder.inlinedResponses?.inlinedResponses ?? [];
    let usdTotal = 0;
    const students = inlined.map(item => {
      const key = item.metadata?.key ?? "";
      if (item.error || !item.response) return { key, cells: [], usd: 0, errors: [`판독 A: ${item.error?.message ?? "응답 없음"}`] };
      try {
        const { data, usage } = parseGeminiPayload(item.response);
        const usd = BATCH_DISCOUNT * (usage.input * gemini.priceInputPerM + (usage.output + usage.thoughts) * gemini.priceOutputPerM) / 1e6;
        usdTotal += usd;
        return { key, cells: [...readingsOf(data)].map(([id, a]) => ({ id, a, b: null })), usd, errors: [] as string[] };
      } catch (e) {
        return { key, cells: [], usd: 0, errors: [`판독 A: ${e instanceof Error ? e.message : String(e)}`] };
      }
    });
    await audit("assessment_cells_batch_done", { batch: name, students: students.length, usd: usdTotal });
    return Response.json({ state: "done", readers: { a: gemini.model, b: null }, students });
  } catch (error) {
    return errorResponse(error);
  }
}
