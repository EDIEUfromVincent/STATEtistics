// 선생님이 "내 API 키"에서 고르는 Gemini 판독 모델. 요금은 Google 공개 요금표(유료 등급, USD per 1M tokens) 기준 추정용이다.
// 한 반 요금은 6-4반(24명, 칸 34개)을 묶음 그림으로 바로 판독했을 때 앱이 잰 값(약 581원, 3.8 Flash)이다 (확인 판독 Claude 요금 제외).

export type GeminiModel = { id: string; label: string; input: number; output: number; perClass: string; note: string };

export const GEMINI_MODELS: GeminiModel[] = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (권장)", input: 0.75, output: 3.75, perClass: "한 반 약 600원", note: "6-4반 검증에 쓴 모델입니다. 2027년부터 요금이 두 배가 됩니다." },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", input: 0.75, output: 3.75, perClass: "한 반 약 600원", note: "3.8과 요금이 같습니다. 2027년부터 요금이 두 배가 됩니다." },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", input: 0.75, output: 3.75, perClass: "한 반 약 600원", note: "3.8과 요금이 같습니다. 2027년부터 요금이 두 배가 됩니다." },
];

export const geminiModelOf = (id?: string | null) => GEMINI_MODELS.find(m => m.id === id) ?? GEMINI_MODELS[0];
