// 두 판독(서로 다른 계열 모델)을 정답표와 대조해 자동 확정할지, 교사에게 넘길지 정한다.
// 원칙: 채점이 틀리는 것보다 교사 확인이 느는 편이 낫다. 애매하면 모두 교사 확인.
//  - 두 판독이 같고 정답이면 → 자동 정답
//  - 두 판독이 같고 정답과 확실히 다르면 → 자동 오답
//  - 판독이 다르거나, 정답과 자모 한두 개만 다르면(높아↔놓아처럼 잘못 읽었을 수 있음) → 교사 확인

import type { Item } from "./answerKey.ts";
import { gradeItem } from "./grade.ts";
import { nfc } from "./normalize.ts";

export const SURE = 1; // records.buildRows에서 0.7 미만은 교사 확인 목록으로 간다
export const UNSURE = 0.3;

export type Decision = { answer: string; confidence: number; note: string };

/** 한글 음절을 초성·중성·종성으로 풀어 비교한다 */
function jamo(s: string) {
  const out: string[] = [];
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c >= 0 && c < 11172) out.push(`a${Math.floor(c / 588)}`, `b${Math.floor((c % 588) / 28)}`, `c${c % 28}`);
    else out.push(ch);
  }
  return out;
}

export function jamoDistance(a: string, b: string) {
  const x = jamo(a), y = jamo(b);
  let row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const next = [i];
    for (let j = 1; j <= y.length; j++) next.push(Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)));
    row = next;
  }
  return row[y.length];
}

const squash = (s: string) => nfc(s).replace(/\s+/g, "");

/** 오답 판독이 정답 가운데 하나와 자모 2개 이내로 가까운가 (앞부분만 비교: '놓아진다' vs '높아') */
export function nearKey(item: Item, answer: string) {
  if (item.kind !== "단답") return false;
  const a = squash(answer);
  const alts = (item.parsed as string[][]).flat().map(squash).filter(Boolean);
  const head = (n: number) => [...a].slice(0, n).join("");
  return alts.some(k => Math.min(jamoDistance(head([...k].length), k), jamoDistance(head([...k].length + 1), k)) <= 2);
}

export function decide(item: Item, a: string | null, b: string | null): Decision {
  if (item.kind === "서술") {
    // 서술형은 교사가 점수를 확정한다. 옮겨 적은 글은 참고용
    const text = a ?? b ?? "";
    const note = a != null && b != null && squash(a) !== squash(b) ? `다른 판독: ${b}` : "";
    return { answer: text, confidence: SURE, note };
  }
  if (a == null || b == null) return { answer: a ?? b ?? "", confidence: UNSURE, note: "판독 하나 실패" };
  const ga = gradeItem(item, a);
  const gb = gradeItem(item, b);
  if (ga.normalized !== gb.normalized || squash(a) !== squash(b) && item.kind === "단답") {
    return { answer: a, confidence: UNSURE, note: `두 판독 다름: "${a}" / "${b}"` };
  }
  if (ga.correct === true) return { answer: a, confidence: SURE, note: "" };
  if (ga.correct == null) return { answer: a, confidence: UNSURE, note: "판독을 채점 규칙으로 해석할 수 없음" };
  if (!nfc(a)) return { answer: "", confidence: SURE, note: "" }; // 둘 다 빈칸
  if (nearKey(item, a)) return { answer: a, confidence: UNSURE, note: "정답과 한두 자모 차이 — 잘못 읽었을 수 있음" };
  return { answer: a, confidence: SURE, note: "" };
}
