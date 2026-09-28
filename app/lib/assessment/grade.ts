// 문항 채점. 정답이 정해진 문항은 규칙으로만 채점하고 AI를 쓰지 않는다.

import type { Item } from "./answerKey.ts";
import { containsTerm, nfc, parseNumbers, parseOx, parseSymbols } from "./normalize.ts";

export const AUTO = "자동";
export const NEEDS_TEACHER = "교사확인필요";
export const CONFIRMED = "교사확정";

export type GradeResult = {
  normalized: string;
  correct: boolean | null;
  score: number | null;
  method: string;
  flags: string[];
  parts: boolean[];
};

const result = (normalized: string, correct: boolean | null, score: number | null, method: string, flags: string[] = [], parts: boolean[] = []): GradeResult =>
  ({ normalized, correct, score, method, flags, parts });

export function gradeItem(item: Item, rawAnswer: string | null | undefined): GradeResult {
  const raw = nfc(rawAnswer);
  if (!raw) return result("", false, 0, AUTO, ["무응답"]);

  switch (item.kind) {
    case "서술":
      return result(raw, null, null, NEEDS_TEACHER, ["서술형"]);

    case "선택형":
    case "복수선택": {
      const got = parseNumbers(raw);
      const norm = got.join(",");
      if (!got.length) return result(raw, null, null, NEEDS_TEACHER, ["판독불가"]);
      if (item.choices && got.some(n => n < 1 || n > item.choices)) return result(norm, null, null, NEEDS_TEACHER, ["보기범위밖"]);
      if (item.kind === "선택형" && got.length > 1) return result(norm, false, 0, AUTO, ["복수응답"]);
      const want = item.parsed as number[];
      const ok = got.length === want.length && got.every(n => want.includes(n));
      return result(norm, ok, ok ? item.points : 0, AUTO);
    }

    case "기호": {
      const got = parseSymbols(raw);
      if (!got.length) return result(raw, null, null, NEEDS_TEACHER, ["판독불가"]);
      const want = item.parsed as string[];
      const ok = got.length === want.length && got.every(s => want.includes(s));
      return result(got.join(","), ok, ok ? item.points : 0, AUTO);
    }

    case "OX": {
      const got = parseOx(raw);
      const want = item.parsed as string[];
      if (got.length !== want.length) return result(got.join("") || raw, null, null, NEEDS_TEACHER, [`OX개수불일치(${got.length}/${want.length})`]);
      const parts = got.map((g, i) => g === want[i]);
      const ok = parts.every(Boolean);
      return result(got.join(""), ok, ok ? item.points : 0, AUTO, [], parts);
    }

    case "단답": {
      const parts = (item.parsed as string[][]).map(alts => containsTerm(raw, alts));
      const ok = parts.every(Boolean);
      return result(raw, ok, ok ? item.points : 0, AUTO, ok || !parts.some(Boolean) ? [] : ["부분정답"], parts);
    }
  }
}
