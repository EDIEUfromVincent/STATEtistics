import { currentTeacher, teacherKeys } from "../../../lib/server/auth";
import { geminiConfig } from "../_gemini";
import { readerConfig } from "../_readers";

// 로그인한 선생님 기준의 판독 준비 상태와 비용 추정에 쓸 요금. 비용이 드는 호출은 하지 않는다.
export async function GET(request: Request) {
  const teacher = await currentTeacher(request).catch(() => null);
  const keys = teacher ? await teacherKeys(teacher.id) : undefined;
  const cfg = geminiConfig(keys);
  const rc = readerConfig(keys);
  const readerReady = rc.provider === "gemini" ? rc.geminiReady : rc.claudeReady;
  const login = teacher ? [] : ["구글 로그인"];
  const geminiMissing = [!cfg.apiKey && "내 Gemini API 키", cfg.apiKey && !cfg.paidTier && "Gemini 유료 등급 표시"].filter(Boolean) as string[];
  const cells = {
    ready: Boolean(teacher) && readerReady,
    missing: [...login, ...(teacher && !readerReady ? (rc.provider === "gemini" ? geminiMissing : ["내 Anthropic API 키"]) : [])],
    a: rc.provider === "gemini" ? rc.geminiModel : rc.claudeModel,
    b: rc.localUrl ? rc.localModel : null,
    verify: rc.verifyModel || null,
  };
  return Response.json({
    cells,
    ready: Boolean(teacher) && Boolean(cfg.apiKey) && cfg.paidTier,
    missing: [...login, ...(teacher ? geminiMissing : [])],
    model: cfg.model,
    pricing: { inputPerM: cfg.priceInputPerM, outputPerM: cfg.priceOutputPerM, usdKrw: cfg.usdKrw },
  });
}
