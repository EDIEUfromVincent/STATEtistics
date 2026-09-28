// long format에서 문항 분석과 성취기준별 근거를 만든다.
// 성취수준(A·B·C)을 판정하지 않는다. 판정은 교사가 성취수준 기술과 비교해서 한다.

import type { LongRow } from "./records.ts";

const CHOICE_KINDS = new Set(["선택형", "복수선택", "기호", "OX"]);
const num = (v: string) => (v === "" || v == null ? null : Number(v));
const round = (v: number) => Math.round(v * 1000) / 1000;
const byItemNo = (a: string, b: string) => (Number(a) - Number(b)) || a.localeCompare(b);

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const map = new Map<string, T[]>();
  for (const r of rows) map.set(key(r), [...(map.get(key(r)) ?? []), r]);
  return map;
}

export function studentTotals(rows: LongRow[]) {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.학생코드, (totals.get(r.학생코드) ?? 0) + (num(r.점수) ?? 0));
  return totals;
}

export type ItemStat = {
  문항: string; 유형: string; 성취기준: string; 행동영역: string; 난이도: string;
  응시: number; 채점완료: number; 미확정: number; 무응답: number;
  정답률: number | null; 변별도: number | null; 비고: string;
};

export function itemStats(rows: LongRow[]): ItemStat[] {
  const totals = studentTotals(rows);
  const ranked = [...totals.keys()].sort((a, b) => totals.get(b)! - totals.get(a)!);
  const k = Math.max(1, Math.round(ranked.length * 0.27));
  const upper = new Set(ranked.slice(0, k));
  const lower = new Set(ranked.slice(-k));

  return [...groupBy(rows, r => r.문항)].sort((a, b) => byItemNo(a[0], b[0])).map(([no, rs]) => {
    const scored = rs.filter(r => r.정오 === "O" || r.정오 === "X");
    const rate = (group?: Set<string>) => {
      const g = group ? scored.filter(r => group.has(r.학생코드)) : scored;
      return g.length ? g.filter(r => r.정오 === "O").length / g.length : null;
    };
    const pending = rs.length - scored.length;
    // 확정 안 된 답이 남아 있으면 무응답만으로 계산한 0%가 나오므로 비워 둔다
    const p = pending ? null : rate();
    const pu = pending ? null : rate(upper);
    const pl = pending ? null : rate(lower);
    const first = rs[0];
    return {
      문항: no, 유형: first.유형, 성취기준: first.성취기준, 행동영역: first.행동영역, 난이도: first.난이도,
      응시: rs.length, 채점완료: scored.length, 미확정: pending,
      무응답: rs.filter(r => r.표시.includes("무응답")).length,
      정답률: p == null ? null : round(p),
      변별도: pu == null || pl == null ? null : round(pu - pl),
      비고: pending ? "교사 확정 후 계산" : "",
    };
  });
}

export type Distractor = { 문항: string; 응답: string; 학생수: number; 비율: number; 정답: boolean };

/** 선택형·기호·OX에서 어떤 오답이 몰렸는지. 오개념을 찾는 출발점. */
export function distractors(rows: LongRow[]): Distractor[] {
  const out: Distractor[] = [];
  const graded = rows.filter(r => CHOICE_KINDS.has(r.유형) && (r.정오 === "O" || r.정오 === "X"));
  for (const [no, rs] of [...groupBy(graded, r => r.문항)].sort((a, b) => byItemNo(a[0], b[0]))) {
    const counts = groupBy(rs, r => r.정규화응답 || "(무응답)");
    for (const [resp, group] of [...counts].sort((a, b) => b[1].length - a[1].length)) {
      out.push({ 문항: no, 응답: resp, 학생수: group.length, 비율: round(group.length / rs.length), 정답: group.some(r => r.정오 === "O") });
    }
  }
  return out;
}

export type StudentStandard = {
  학생코드: string; 성취기준: string; 문항수: number; 채점완료: number;
  득점: number; 배점: number; 득점률: number | null; 틀린문항: string; 행동영역: string;
};

export function studentStandards(rows: LongRow[]): StudentStandard[] {
  return [...groupBy(rows, r => `${r.학생코드}\u0000${r.성취기준}`)].sort((a, b) => a[0].localeCompare(b[0])).map(([key, rs]) => {
    const [code, std] = key.split("\u0000");
    const scored = rs.filter(r => num(r.점수) != null);
    const got = scored.reduce((s, r) => s + (num(r.점수) ?? 0), 0);
    const max = scored.reduce((s, r) => s + Number(r.배점), 0);
    return {
      학생코드: code, 성취기준: std, 문항수: rs.length, 채점완료: scored.length,
      득점: got, 배점: max, 득점률: max ? round(got / max) : null,
      틀린문항: scored.filter(r => r.정오 === "X").map(r => r.문항).join(","),
      행동영역: [...new Set(rs.map(r => r.행동영역).filter(Boolean))].sort().join(","),
    };
  });
}

export type ClassStandard = { 성취기준: string; 학생수: number; 문항수: number; 평균득점률: number | null; 절반미만학생수: number; 행동영역: string };

export function classStandards(per: StudentStandard[]): ClassStandard[] {
  return [...groupBy(per, r => r.성취기준)].sort((a, b) => a[0].localeCompare(b[0])).map(([std, rs]) => {
    const rates = rs.map(r => r.득점률).filter((v): v is number => v != null);
    return {
      성취기준: std, 학생수: rs.length, 문항수: rs[0].문항수,
      평균득점률: rates.length ? round(rates.reduce((a, b) => a + b, 0) / rates.length) : null,
      절반미만학생수: rates.filter(v => v < 0.5).length,
      행동영역: rs[0].행동영역,
    };
  });
}
