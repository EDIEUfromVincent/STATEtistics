// 판독 신뢰도: 모델이 스스로 매긴 확신도는 잘 맞지 않으므로, 실제 검증에서 잰 "AI 답이 맞은 비율"을 쓴다.
// 6-4반 24명(2026-10-01, 주 판독 gemini-3.8-flash + 확인 판독 claude-sonnet-5-5)을
// 두 모델 판독과 칸 조각 대조로 채점해 얻은 값이다. 표본이 작은 이유는 그대로 표시한다.

export type Reason = "auto" | "ink" | "verifier" | "near" | "marks" | "inkEmpty" | "form" | "disagree" | "other";

const MEASURED: Record<Reason, { ok: number; n: number } | null> = {
  auto: { ok: 584, n: 586 }, // 자동 확정 칸
  ink: null, // 잉크로 판정(빈칸·고르는 칸): 따로 재지 않았다
  verifier: { ok: 28, n: 36 }, // 확인 판독기가 다르게 읽음
  near: { ok: 14, n: 16 }, // 정답과 한두 자모 차이
  marks: { ok: 5, n: 5 }, // 학생 표시가 둘 이상
  inkEmpty: { ok: 4, n: 4 }, // 잉크는 있는데 빈칸으로 읽힘
  form: null, // 빈 양식과 다른 쪽
  disagree: null, // 두 판독기가 다름 (로컬 판독기를 쓸 때)
  other: null,
};

/** 교사 확인 메모에서 이유를 찾는다 (가장 먼저 걸린 이유) */
export function reasonOf(note: string, sure: boolean): Reason {
  if (!note) return sure ? "auto" : "other";
  if (note.includes("양식")) return "form";
  if (note.includes("표시가 둘 이상")) return "marks";
  if (note.includes("잉크는 있는데")) return "inkEmpty";
  if (note.includes("보기에 표시가 없고") || note.includes("확인 판독")) return "verifier";
  if (note.includes("한두 자모")) return "near";
  if (note.includes("두 판독 다름")) return "disagree";
  if (note.includes("잉크로 판정")) return "ink";
  return sure ? "auto" : "other";
}

/** 예: "78% (36칸 중 28칸)" — 잰 적이 없으면 "측정 전" */
export function accuracyLabel(reason: Reason) {
  const m = MEASURED[reason];
  if (!m) return "측정 전";
  const pct = Math.round((m.ok / m.n) * 1000) / 10;
  return `${pct}% (${m.n}칸 중 ${m.ok}칸)${m.n < 10 ? " · 표본 적음" : ""}`;
}
