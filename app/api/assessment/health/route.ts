import { geminiConfig } from "../_gemini";
import { readerConfig } from "../_readers";

// 설정 상태와 비용 추정에 쓸 요금만 알려 준다. 비용이 드는 Gemini 호출은 하지 않는다.
export async function GET() {
  const cfg = geminiConfig();
  const missing = [
    !cfg.accessKeySet && "STATETISTIC_ACCESS_KEY",
    !cfg.apiKey && "GEMINI_API_KEY",
    !cfg.paidTier && "GEMINI_PAID_TIER=true",
  ].filter(Boolean);
  // 양식 기반 칸 판독 (Claude + 로컬). 로컬 판독기가 없으면 모든 손글씨 칸이 교사 확인으로 간다
  const rc = readerConfig();
  const readerReady = rc.provider === "gemini" ? rc.geminiReady : rc.claudeReady;
  const cells = {
    ready: cfg.accessKeySet && readerReady,
    missing: [!cfg.accessKeySet && "STATETISTIC_ACCESS_KEY", !readerReady && (rc.provider === "gemini" ? "GEMINI_API_KEY, GEMINI_PAID_TIER=true" : "ANTHROPIC_API_KEY")].filter(Boolean),
    a: rc.provider === "gemini" ? rc.geminiModel : rc.claudeModel,
    b: rc.localUrl ? rc.localModel : null,
    verify: rc.verifyModel && rc.claudeReady ? rc.verifyModel : null,
  };
  return Response.json(
    {
      cells,
      ready: missing.length === 0,
      missing,
      model: cfg.model,
      pricing: { inputPerM: cfg.priceInputPerM, outputPerM: cfg.priceOutputPerM, usdKrw: cfg.usdKrw },
    },
    { status: missing.length && !cells.ready ? 503 : 200 },
  );
}
