// 가상 반. 무작위가 아니라 '능력 + 문항 난이도 + 흔한 오개념' 모형으로 응답을 만들고,
// 실제 채점기와 같은 경로(buildRows)로 채점한다. 그래서 연습 분석에서도 의미 있는 모양이 나온다.

import type { Item } from "./answerKey.ts";
import { createRoster, maskNames } from "./privacy.ts";
import { buildRows, reviewKey, type EssayReview, type LongRow, type Readings } from "./records.ts";

const SURNAMES = "김이박최정강조윤장임한오서신권";
const GIVEN = ["서윤", "도윤", "하린", "민준", "시우", "지우", "유진", "은호", "예린", "선우", "하율", "주원",
  "윤서", "지민", "현우", "다은", "수빈", "준서", "아인", "태윤", "소율", "건우", "채원", "지호", "나은"];
const DIFFICULTY: Record<string, number> = { 하: -1, 중: 0, 상: 1 };
const CIRCLED = "①②③④⑤⑥⑦⑧⑨";
const SYMBOLS = "㉠㉡㉢㉣";
const ESSAY = {
  high: "빛과 열이 납니다. 탈 물질과 산소가 있고 온도가 발화점 이상이 되어야 물질이 탑니다.",
  mid: "양초와 알코올 모두 탈 때 빛과 열이 난다.",
  low: "불꽃이 흔들린다.",
};

export function seededRandom(seed: number) {
  let t = Math.abs(Math.trunc(seed)) || 1;
  return () => ((t = (t * 1664525 + 1013904223) >>> 0), t / 4294967296);
}

function gauss(random: () => number) {
  const u = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

const pCorrect = (theta: number, b: number) => 1 / (1 + Math.exp(-1.7 * (theta - b)));

function answerFor(it: Item, theta: number, random: () => number, names: string[]) {
  const b = DIFFICULTY[it.difficulty] ?? 0;
  const ok = random() < pCorrect(theta, b);
  const confidence = random() > 0.06 ? 0.99 : 0.55; // 가끔 판독이 불확실한 답
  const choose = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)];
  if (random() < 0.03) return { answer: "", confidence: 0.99 };

  switch (it.kind) {
    case "선택형": {
      const key = (it.parsed as number[])[0];
      const popular = (key % it.choices) + 1; // 흔한 오개념 하나에 오답이 몰리게
      const others = Array.from({ length: it.choices }, (_, i) => i + 1).filter(n => n !== key);
      return { answer: CIRCLED[(ok ? key : random() < 0.6 ? popular : choose(others)) - 1], confidence };
    }
    case "복수선택": {
      const key = it.parsed as number[];
      const ans = ok ? key : choose([[key[0]], [key[0], (key[key.length - 1] % it.choices) + 1]]);
      return { answer: ans.map(n => CIRCLED[n - 1]).join(", "), confidence };
    }
    case "기호": {
      const idx = "ㄱㄴㄷㄹ".indexOf((it.parsed as string[])[0]);
      return { answer: ok ? SYMBOLS[idx] : SYMBOLS[(idx + 1) % 4], confidence };
    }
    case "OX": {
      const parts = (it.parsed as string[]).map(w => (random() < pCorrect(theta, b - 0.6) ? w : w === "O" ? "X" : "O"));
      return { answer: parts.map(p => (p === "O" ? "○" : "×")).join(","), confidence };
    }
    case "단답":
      return ok
        ? { answer: choose(["물, 이산화 탄소", "물과 이산화탄소", "이산화 탄소, 물"]), confidence }
        : { answer: choose(["산소, 물", "연기", "물질"]), confidence };
    case "서술": {
      const level = theta > 0.6 ? "high" : theta > -0.6 ? "mid" : "low";
      const text = random() < 0.15 ? `${choose(names).slice(1)}랑 같이 관찰했는데 ${ESSAY[level]}` : ESSAY[level];
      return { answer: text, confidence: 0.9 };
    }
  }
}

/** 가상 교사가 서술형을 채점한 결과 (연습 데이터가 끝까지 채워지도록) */
function simulatedEssayScore(it: Item, answer: string) {
  if (answer.includes("발화점")) return it.points;
  if (answer.includes("빛과 열")) return Math.round(it.points / 2);
  return Math.round(it.points / 5);
}

export type SyntheticClass = { rows: LongRow[]; readings: Readings; names: string[] };

export function demoNames(count: number) {
  return Array.from({ length: count }, (_, i) => SURNAMES[i % SURNAMES.length] + GIVEN[i % GIVEN.length]);
}

/** 가상 판독 결과. 실제 흐름과 똑같이 이름을 가린 뒤 돌려준다. */
export function syntheticReadings(items: Item[], codes: string[], names: string[], seed: number) {
  const random = seededRandom(seed);
  const readings: Readings = {};
  const raw: Record<string, Record<string, string>> = {};
  for (const code of codes) {
    const theta = gauss(random);
    readings[code] = {};
    raw[code] = {};
    for (const it of items) {
      const a = answerFor(it, theta, random, names);
      const masked = maskNames(a.answer, names);
      readings[code][it.no] = { answer: masked.text, confidence: a.confidence, nameHits: masked.hits.length };
      raw[code][it.no] = a.answer;
    }
  }
  return { readings, raw };
}

export function generateClass(items: Item[], options: { students: number; seed: number; assessmentId: string; confirmEssays?: boolean }): SyntheticClass {
  const names = demoNames(options.students);
  const roster = createRoster(names);
  const { readings, raw } = syntheticReadings(items, roster.map(s => s.code), names, options.seed);
  const essayReview: Record<string, EssayReview> = {};
  if (options.confirmEssays) {
    for (const s of roster) {
      for (const it of items) {
        const answer = raw[s.code][it.no];
        if (it.kind === "서술" && answer) essayReview[reviewKey(s.code, it.no)] = { final: simulatedEssayScore(it, answer) };
      }
    }
  }
  const readReview = options.confirmEssays
    ? Object.fromEntries(Object.entries(readings).flatMap(([code, rs]) => Object.keys(rs).map(no => [reviewKey(code, no), { confirmed: true }])))
    : {};
  const { rows } = buildRows(items, readings, { assessmentId: options.assessmentId, source: "합성(가상 반)", essayReview, readReview });
  return { rows, readings, names };
}
