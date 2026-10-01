import { AssessmentApiError, audit, errorResponse, sha256, teacherContext } from "../_gemini";
import { readerConfig, readWithClaude, readWithGemini, readWithLocal, type CellInput } from "../_readers";

const MAX_CELLS = 40;
const MAX_BASE64 = 2_000_000; // 조각 하나 약 1.5MB PNG

// 학생 한 명의 "빈 양식 칸 | 학생 칸" 조각을 두 판독기(Claude, 로컬)에 동시에 맡긴다.
export async function POST(request: Request) {
  try {
    const { keys } = await teacherContext(request);
    const cfg = readerConfig(keys);
    if (cfg.provider === "claude" && !cfg.claudeReady) throw new AssessmentApiError("\"내 API 키\"에서 Gemini 또는 Anthropic API 키를 넣어 주세요.", 403);
    if (cfg.provider === "gemini" && !cfg.geminiReady) throw new AssessmentApiError(keys.gemini ? "학생 자료는 Gemini 유료 등급 키로만 처리합니다. \"내 API 키\"에서 유료 등급이라고 표시해 주세요." : "\"내 API 키\"에서 Gemini API 키를 넣어 주세요.", 403);
    const body = (await request.json()) as { cells?: unknown; verify?: unknown };
    if (!Array.isArray(body.cells) || !body.cells.length || body.cells.length > MAX_CELLS) {
      throw new AssessmentApiError(`칸은 한 번에 1~${MAX_CELLS}개를 보내야 합니다.`, 400);
    }
    const seen = new Set<string>();
    const cells: CellInput[] = body.cells.map(v => {
      const c = v as Partial<CellInput>;
      if (typeof c.id !== "string" || !/^[\w-]{1,8}$/.test(c.id) || seen.has(c.id)) throw new AssessmentApiError("칸 번호가 올바르지 않습니다.", 400);
      seen.add(c.id);
      for (const img of [c.blank, c.student]) {
        if (typeof img !== "string" || !img || img.length > MAX_BASE64 || !img.startsWith("iVBORw0KGgo")) {
          throw new AssessmentApiError("브라우저에서 만든 칸 조각(PNG)만 받습니다.", 400);
        }
      }
      const hint = typeof c.hint === "string" ? c.hint.replace(/[\r\n]+/g, " ").slice(0, 80) : "";
      return { id: c.id, hint, blank: c.blank!, student: c.student! };
    });

    // 확인 판독: 주 판독이 정답으로 읽은 칸만 다른 계열 모델(Claude)로 다시 읽는다
    if (body.verify === true) {
      if (!cfg.verifyModel || !cfg.claudeReady) throw new AssessmentApiError("확인 판독에는 Anthropic API 키가 필요합니다.", 403);
      const v = await readWithClaude(cells, keys, cfg.verifyModel);
      await audit("assessment_cells_verify", { cells: cells.length, reader: v.model, usage: v.usage });
      return Response.json({ cells: cells.map(c => ({ id: c.id, a: v.readings.get(c.id) ?? null })), reader: v.model, usage: v.usage, usd: v.usd });
    }

    const errors: string[] = [];
    const [a, b] = await Promise.allSettled([
      cfg.provider === "gemini" ? readWithGemini(cells, keys) : readWithClaude(cells, keys),
      cfg.localUrl ? readWithLocal(cells) : Promise.resolve(null),
    ]);
    if (a.status === "rejected") {
      // 설정·인증 문제는 남은 학생도 모두 실패하므로 그대로 알린다
      if (a.reason instanceof AssessmentApiError && (a.reason.status === 503 || a.reason.status === 403)) throw a.reason;
      errors.push(`판독 A: ${a.reason instanceof Error ? a.reason.message : String(a.reason)}`);
    }
    if (b.status === "rejected") errors.push(`판독 B: ${b.reason instanceof Error ? b.reason.message : String(b.reason)}`);
    const ra = a.status === "fulfilled" ? a.value : null;
    const rb = b.status === "fulfilled" ? b.value : null;

    await audit("assessment_cells", {
      cells: cells.length,
      sha256: await Promise.all(cells.map(c => sha256(Uint8Array.from(atob(c.student), ch => ch.charCodeAt(0))))),
      readerA: ra?.model ?? null, readerB: rb?.model ?? null, usage: ra?.usage ?? null, errors: errors.length,
    });

    return Response.json({
      cells: cells.map(c => ({ id: c.id, a: ra?.readings.get(c.id) ?? null, b: rb?.readings.get(c.id) ?? null })),
      readers: { a: ra?.model ?? (cfg.provider === "gemini" ? cfg.geminiModel : cfg.claudeModel), b: cfg.localUrl ? rb?.model ?? cfg.localModel : null },
      usage: ra?.usage ?? { input: 0, output: 0 },
      usd: ra?.usd ?? 0,
      errors,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
