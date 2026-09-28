// 판독 결과 + 정답표 + 교사 확인 → 학생×문항 한 줄(long format) 데이터.

import type { Item } from "./answerKey.ts";
import { CONFIRMED, gradeItem, AUTO } from "./grade.ts";

export const LONG_COLUMNS = [
  "학생코드", "평가ID", "출처", "문항", "유형", "응답", "정규화응답", "정오", "점수", "배점",
  "성취기준", "행동영역", "난이도", "채점방식", "표시", "판독신뢰도",
] as const;
export type LongRow = Record<(typeof LONG_COLUMNS)[number], string>;

export type Reading = { answer: string; confidence: number; nameHits: number };
export type Readings = Record<string, Record<string, Reading>>; // 학생코드 → 문항 → 판독

export type ReadReview = { confirmed?: boolean; fixed?: string };
export type EssayReview = { final?: number | null; aiScore?: number | null; aiEvidence?: string; aiUnstable?: boolean };
export const reviewKey = (code: string, no: string) => `${code}|${no}`;

/** 두 쪽에 걸친 문항: 한쪽만 답이 있으면 그것을, 둘 다 다르면 교사 확인으로 보낸다. */
export function mergePages(old: Reading | undefined, next: Reading): Reading {
  if (!old || !old.answer) return next.answer || !old ? next : old;
  if (!next.answer || next.answer === old.answer) return old;
  return { answer: `${old.answer} / ${next.answer}`, confidence: 0, nameHits: old.nameHits + next.nameHits };
}

export type BuildOptions = {
  assessmentId: string;
  source: string;
  lowConfidence?: number;
  readReview?: Record<string, ReadReview>;
  essayReview?: Record<string, EssayReview>;
};

export type BuildResult = {
  rows: LongRow[];
  // 처리한 뒤에도 목록에 남겨 교사가 다시 보고 되돌릴 수 있게 한다
  readQueue: Array<{ code: string; no: string; answer: string; confidence: number; reviewed: boolean }>;
  essayQueue: Array<{ code: string; no: string; answer: string; item: Item }>;
};

export function buildRows(items: Item[], readings: Readings, options: BuildOptions): BuildResult {
  const low = options.lowConfidence ?? 0.7;
  const readReview = options.readReview ?? {};
  const essayReview = options.essayReview ?? {};
  const rows: LongRow[] = [];
  const readQueue: BuildResult["readQueue"] = [];
  const essayQueue: BuildResult["essayQueue"] = [];

  for (const code of Object.keys(readings).sort()) {
    for (const it of items) {
      const reading = readings[code][it.no] ?? { answer: "", confidence: 0, nameHits: 0 };
      const key = reviewKey(code, it.no);
      const review = readReview[key] ?? {};
      let answer = reading.answer;
      const flags: string[] = [];
      const uncertain = Boolean(answer) && reading.confidence < low && it.kind !== "서술";
      const fixed = review.fixed?.trim() ?? "";
      if (uncertain || fixed || review.confirmed) {
        readQueue.push({ code, no: it.no, answer: reading.answer, confidence: reading.confidence, reviewed: Boolean(fixed || review.confirmed) });
      }
      if (fixed) {
        answer = fixed;
        flags.push("판독수정");
      } else if (review.confirmed) {
        flags.push("판독확인");
      } else if (uncertain) {
        flags.push("판독확인필요");
      }
      if (reading.nameHits) flags.push("이름가림");

      const res = gradeItem(it, answer);
      flags.push(...res.flags);
      let { score, correct, method } = res;

      if (it.kind === "서술" && answer) {
        essayQueue.push({ code, no: it.no, answer, item: it });
        const final = essayReview[key]?.final;
        if (final != null && Number.isFinite(final)) {
          score = Math.max(0, Math.min(it.points, final));
          correct = score >= it.points;
          method = CONFIRMED;
        }
      }

      rows.push({
        학생코드: code, 평가ID: options.assessmentId, 출처: options.source, 문항: it.no, 유형: it.kind,
        응답: answer, 정규화응답: res.method === AUTO ? res.normalized : "",
        정오: correct == null ? "" : correct ? "O" : "X",
        점수: score == null ? "" : String(score), 배점: String(it.points),
        성취기준: it.standard, 행동영역: it.domain, 난이도: it.difficulty,
        채점방식: method, 표시: flags.join(";"), 판독신뢰도: String(reading.confidence),
      });
    }
  }
  return { rows, readQueue, essayQueue };
}

export function pendingCount(rows: LongRow[]) {
  return rows.filter(r => r.정오 === "" || r.표시.includes("판독확인필요")).length;
}
