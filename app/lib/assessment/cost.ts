// Gemini 비용 추정과 실제 사용량 합계.
// Gemini는 이미지를 768px 조각으로 나눠 조각마다 약 258토큰으로 계산한다(작은 이미지는 258토큰 하나).
// 요금은 서버 설정(/api/assessment/health)에서 받아 오며, 실제 청구액은 Google Cloud 결제 화면이 기준이다.

export type Pricing = { inputPerM: number; outputPerM: number; usdKrw: number };
export type Usage = { input: number; output: number; thoughts: number };

export const DEFAULT_PRICING: Pricing = { inputPerM: 0.3, outputPerM: 2.5, usdKrw: 1400 };
export const ZERO_USAGE: Usage = { input: 0, output: 0, thoughts: 0 };

export function imageTokens(width: number, height: number) {
  if (width <= 384 && height <= 384) return 258;
  return Math.ceil(width / 768) * Math.ceil(height / 768) * 258;
}

/** 판독 예상 사용량: 학생 1명당 요청 1번 */
export function estimateOcr(students: number, pageSizes: Array<[number, number]>, items: number): Usage {
  const perStudentImages = pageSizes.reduce((sum, [w, h]) => sum + imageTokens(w, h), 0);
  const prompt = 250 + items * 15;
  return { input: students * (perStudentImages + prompt), output: students * items * 20, thoughts: 0 };
}

export function addUsage(a: Usage, b: Partial<Usage> | undefined): Usage {
  return { input: a.input + (b?.input ?? 0), output: a.output + (b?.output ?? 0), thoughts: a.thoughts + (b?.thoughts ?? 0) };
}

/** 생각 토큰은 출력 요금으로 청구된다 */
export function costKrw(usage: Usage, pricing: Pricing) {
  const usd = (usage.input * pricing.inputPerM + (usage.output + usage.thoughts) * pricing.outputPerM) / 1_000_000;
  return usd * pricing.usdKrw;
}

export function formatKrw(krw: number) {
  if (krw < 1) return "1원 미만";
  return `약 ${Math.round(krw).toLocaleString()}원`;
}
