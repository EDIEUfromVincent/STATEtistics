import {
  analyzeWithTabPFN,
  getPriorLabsApiKey,
  hasValidStudioAccessKey,
  TabPFNError,
} from "../_shared";

export async function POST(request: Request) {
  if (!hasValidStudioAccessKey(request)) {
    return Response.json({ error: "STATEtistic 분석 액세스 코드가 올바르지 않습니다." }, { status: 401 });
  }

  const apiKey = getPriorLabsApiKey();
  if (!apiKey) {
    return Response.json(
      { error: "Railway에 PRIORLABS_API_KEY를 설정해 주세요." },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    return Response.json(await analyzeWithTabPFN(body, apiKey));
  } catch (error) {
    const reason =
      error instanceof TabPFNError
        ? error
        : new TabPFNError(error instanceof Error ? error.message : "TabPFN 분석에 실패했습니다.");
    return Response.json({ error: reason.message }, { status: reason.status });
  }
}
