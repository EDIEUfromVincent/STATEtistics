// 판독 결과 + 정답표 + 교사 확인 → 학생×문항 한 줄(long format) 데이터.

import type { Item } from "./answerKey.ts";
import { CONFIRMED, gradeItem, AUTO } from "./grade.ts";

export const LONG_COLUMNS = [
  "학생코드", "평가ID", "출처", "문항", "유형", "응답", "정규화응답", "정오", "점수", "배점",
  "성취기준", "행동영역", "난이도", "채점방식", "표시", "판독신뢰도",
] as const;
export type LongRow = Record<(typeof LONG_COLUMNS)[number], string>;

// note: 교사 확인으로 보낸 이유 (예: 두 판독이 다름). 칸 판독에서만 채운다
export type Reading = { answer: string; confidence: number; nameHits: number; note?: string };
export type Readings = Record<string, Record<string, Reading>>; // 학생코드 → 문항 → 판독

export type ReadReview = { confirmed?: boolean; fixed?: string };
export type EssayReview = { final?: number | null; aiScore?: number | null; aiEvidence?: string; aiUnstable?: boolean };
export const reviewKey = (code: string, no: string) => `${code}|${no}`;

export const READ_FAILED = "판독실패";
// 교사가 "빈칸으로 고치기"를 누르면 수정값에 이 표시를 넣는다 (수정값이 비어 있으면 "고치지 않음"이라서)
export const BLANK_FIX = "(빈칸)";

export type BuildOptions = {
  assessmentId: string;
  source: string;
  // 응시한 모든 학생. 판독 결과가 없는 학생은 빠뜨리지 않고 "판독실패"(미확정)로 남긴다
  codes?: string[];
  lowConfidence?: number;
  // 첫 사용 때 판독 정확도를 재기 위해 모든 판독을 교사 대조 목록에 올린다
  reviewAll?: boolean;
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

  const codes = options.codes ?? Object.keys(readings);
  for (const code of [...codes].sort()) {
    const read = readings[code];
    for (const it of items) {
      if (!read) {
        // 판독이 안 된 것을 무응답 0점으로 처리하면 점수가 틀린다
        rows.push({
          학생코드: code, 평가ID: options.assessmentId, 출처: options.source, 문항: it.no, 유형: it.kind,
          응답: "", 정규화응답: "", 정오: "", 점수: "", 배점: String(it.points),
          성취기준: it.standard, 행동영역: it.domain, 난이도: it.difficulty,
          채점방식: READ_FAILED, 표시: READ_FAILED, 판독신뢰도: "",
        });
        continue;
      }
      const reading = read[it.no] ?? { answer: "", confidence: 0, nameHits: 0 };
      const key = reviewKey(code, it.no);
      const review = readReview[key] ?? {};
      let answer = reading.answer;
      const flags: string[] = [];
      // 빈칸으로 읽혔어도 확신이 낮으면 교사에게 묻는다 (흐린 글씨가 0점이 되지 않게)
      // 서술형은 점수를 교사가 정하므로 판독 확인에서 빼되, 빈칸으로 읽혔는데 불확실하면 판독 확인에 올린다
      const uncertain = (it.kind !== "서술" || !reading.answer) && (options.reviewAll ? it.kind !== "서술" : reading.confidence < low);
      const fixed = review.fixed?.trim() ?? "";
      if (uncertain || ((fixed || review.confirmed) && it.kind !== "서술")) {
        readQueue.push({ code, no: it.no, answer: reading.answer, confidence: reading.confidence, reviewed: Boolean(fixed || review.confirmed) });
      }
      if (fixed) {
        answer = fixed === BLANK_FIX ? "" : fixed;
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
