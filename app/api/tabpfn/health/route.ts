import {
  checkTabPFN,
  getPriorLabsApiKey,
  requiresStudioAccessKey,
  TabPFNError,
} from "../_shared";

export async function GET() {
  const apiKey = getPriorLabsApiKey();
  if (!apiKey) {
    return Response.json(
      {
        ok: false,
        configured: false,
        error: "Railway에 PRIORLABS_API_KEY를 설정해 주세요.",
      },
      { status: 503 },
    );
  }

  try {
    await checkTabPFN(apiKey);
    return Response.json({
      ok: true,
      configured: true,
      provider: "Prior Labs API",
      requires_access_key: requiresStudioAccessKey(),
    });
  } catch (error) {
    const reason = error instanceof TabPFNError ? error : new TabPFNError("TabPFN API 연결에 실패했습니다.");
    return Response.json(
      { ok: false, configured: true, error: reason.message },
      { status: reason.status },
    );
  }
}
