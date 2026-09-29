import { geminiConfig } from "../_gemini";

// 설정 상태와 비용 추정에 쓸 요금만 알려 준다. 비용이 드는 Gemini 호출은 하지 않는다.
export async function GET() {
  const cfg = geminiConfig();
  const missing = [
    !cfg.accessKeySet && "STATETISTIC_ACCESS_KEY",
    !cfg.apiKey && "GEMINI_API_KEY",
    !cfg.paidTier && "GEMINI_PAID_TIER=true",
  ].filter(Boolean);
  return Response.json(
    {
      ready: missing.length === 0,
      missing,
      model: cfg.model,
      pricing: { inputPerM: cfg.priceInputPerM, outputPerM: cfg.priceOutputPerM, usdKrw: cfg.usdKrw },
    },
    { status: missing.length ? 503 : 200 },
  );
}
