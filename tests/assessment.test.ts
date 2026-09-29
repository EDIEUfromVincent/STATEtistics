import assert from "node:assert/strict";
import test from "node:test";

import { AnswerKeyError, loadAnswerKey, ocrSpec, parseAnswer, type Item, type ItemKind } from "../app/lib/assessment/answerKey.ts";
import { classStandards, distractors, itemStats, studentStandards } from "../app/lib/assessment/analysis.ts";
import { gradeItem, NEEDS_TEACHER } from "../app/lib/assessment/grade.ts";
import { containsTerm, parseNumbers, parseOx, parseShortKey, parseSymbols } from "../app/lib/assessment/normalize.ts";
import { createRoster, maskNames, parseRoster, rosterToCsv, sha256Hex } from "../app/lib/assessment/privacy.ts";
import { buildRows, READ_FAILED, reviewKey } from "../app/lib/assessment/records.ts";
import { costKrw, estimateOcr, imageTokens } from "../app/lib/assessment/cost.ts";
import { SAMPLE_KEY_CSV } from "../app/lib/assessment/sampleKey.ts";
import { generateClass } from "../app/lib/assessment/synthetic.ts";

test("숫자 응답 정규화", () => {
  assert.deepEqual(parseNumbers("③"), [3]);
  assert.deepEqual(parseNumbers("3번"), [3]);
  assert.deepEqual(parseNumbers("①, ③"), [1, 3]);
  assert.deepEqual(parseNumbers("⑴"), [1]);
  assert.deepEqual(parseNumbers(""), []);
});

test("기호 응답 정규화", () => {
  assert.deepEqual(parseSymbols("㉡"), ["ㄴ"]);
  assert.deepEqual(parseSymbols("(가)"), ["가"]);
  assert.deepEqual(parseSymbols("㈎"), ["가"]);
  assert.deepEqual(parseSymbols("㉮"), ["가"]);
  assert.deepEqual(parseSymbols("㉠, ㉢"), ["ㄱ", "ㄷ"]);
  assert.deepEqual(parseSymbols("몰라요"), []);
});

test("OX 응답 정규화", () => {
  assert.deepEqual(parseOx("(1) ○ (2) ○ (3) ×"), ["O", "O", "X"]);
  assert.deepEqual(parseOx("○,×,○"), ["O", "X", "O"]);
  assert.deepEqual(parseOx("1. o 2. x"), ["O", "X"]);
});

test("단답형은 단어로만 인정한다 ('물질' 속 '물'은 아님)", () => {
  const terms = parseShortKey("물|이산화 탄소=이산화탄소=CO2");
  const all = (a: string) => terms.every(alts => containsTerm(a, alts));
  assert.equal(all("물, 이산화 탄소"), true);
  assert.equal(all("물과 이산화탄소"), true);
  assert.equal(all("이산화 탄소랑 물"), true);
  assert.equal(all("CO2, 물"), true);
  assert.equal(all("물질, 이산화 탄소"), false);
  assert.equal(all("산소, 물"), false);
});

function item(kind: ItemKind, answer: string, extra: Partial<Item> = {}): Item {
  return {
    no: "1", pages: [1], kind, answer, points: 5, standard: "[6과14-02]", choices: 5, rubric: "", domain: "",
    difficulty: "", content: "", mappingStatus: "", parsed: parseAnswer(kind, answer), ...extra,
  };
}

test("유형별 채점", () => {
  const choice = item("선택형", "⑤");
  assert.equal(gradeItem(choice, "5번").score, 5);
  assert.equal(gradeItem(choice, "③").score, 0);
  assert.ok(gradeItem(choice, "③, ⑤").flags.includes("복수응답"));
  assert.equal(gradeItem(choice, "⑦").score, null);
  assert.ok(gradeItem(choice, "").flags.includes("무응답"));
  assert.equal(gradeItem(item("복수선택", "①,③"), "③ ①").score, 5);
  assert.equal(gradeItem(item("복수선택", "①,③"), "①").score, 0);
  assert.equal(gradeItem(item("기호", "㉡"), "ㄴ").score, 5);
  const ox = gradeItem(item("OX", "×,○,○"), "× ○ ×");
  assert.equal(ox.score, 0);
  assert.deepEqual(ox.parts, [true, true, false]);
  assert.ok(gradeItem(item("OX", "×,○,○"), "× ○").flags.includes("OX개수불일치(2/3)"));
  const short = gradeItem(item("단답", "물|이산화 탄소"), "물");
  assert.equal(short.score, 0);
  assert.ok(short.flags.includes("부분정답"));
  const essay = gradeItem(item("서술", "", { rubric: "x" }), "빛과 열이 난다");
  assert.equal(essay.score, null);
  assert.equal(essay.method, NEEDS_TEACHER);
});

test("정답표 오류를 한 번에 알려 준다", () => {
  const bad = "문항,페이지,유형,정답,배점,성취기준\n1,1,선택형,\"①,③\",5,[6과14-02]\n2,1,서술,,5,6과14\n";
  assert.throws(() => loadAnswerKey(bad), (e: unknown) => {
    const msg = (e as AnswerKeyError).message;
    return msg.includes("복수선택") && msg.includes("형식이 아닙니다") && msg.includes("채점기준");
  });
  assert.equal(loadAnswerKey(SAMPLE_KEY_CSV).length, 9);
});

test("OCR 요청 정보에는 정답이 없다", () => {
  const items = loadAnswerKey(SAMPLE_KEY_CSV);
  for (const it of items) {
    const spec = ocrSpec(it);
    assert.deepEqual(Object.keys(spec).sort(), ["choices", "kind", "no", "ox"]);
    assert.ok(!JSON.stringify(spec).includes(it.answer) || it.answer === "");
  }
});

test("이름 가리기", () => {
  const names = ["김민준", "이서윤"];
  const { text } = maskNames("민준이랑 이서윤이 같이 했다. 호수민준", names);
  assert.ok(!text.replace("호수민준", "").includes("민준"));
  assert.ok(!text.includes("서윤"));
  assert.ok(text.includes("호수민준")); // 앞이 한글이면 '이름만' 형태는 가리지 않는다
  assert.ok(!maskNames("철수랑김민준이", names).text.includes("김민준")); // 성명은 붙어 있어도 가린다
});

test("명부: 무작위 코드, 동명이인 거부, CSV 왕복", () => {
  const roster = createRoster(["김민준", "이서윤", "박하린"]);
  assert.equal(new Set(roster.map(s => s.code)).size, 3);
  assert.ok(roster.every(s => /^[A-Z][3-9][A-Z]$/.test(s.code)));
  assert.throws(() => createRoster(["김민준", "김민준"]), /같은 이름/);
  const again = createRoster(["김민준", "이서윤", "박하린"], roster);
  assert.deepEqual(again.map(s => s.code), roster.map(s => s.code)); // 기존 코드 유지
  assert.deepEqual(parseRoster(rosterToCsv(roster)), roster);
});

test("판독에 실패한 학생은 0점이 아니라 미확정으로 남는다", () => {
  const items = loadAnswerKey(SAMPLE_KEY_CSV);
  const readings = { K7M: { "1": { answer: "③", confidence: 0.99, nameHits: 0 } } };
  const out = buildRows(items, readings, { assessmentId: "t", source: "t", codes: ["K7M", "X4Y"] });
  const failed = out.rows.filter(r => r.학생코드 === "X4Y");
  assert.equal(failed.length, items.length); // 결과에서 빠지지 않는다
  assert.ok(failed.every(r => r.정오 === "" && r.점수 === "" && r.채점방식 === READ_FAILED));
});

test("빈칸으로 읽혔어도 확신이 낮으면 교사에게 묻는다", () => {
  const items = loadAnswerKey(SAMPLE_KEY_CSV);
  const readings = { K7M: { "1": { answer: "", confidence: 0.3, nameHits: 0 }, "2": { answer: "", confidence: 0.99, nameHits: 0 } } };
  const out = buildRows(items, readings, { assessmentId: "t", source: "t" });
  assert.deepEqual(out.readQueue.map(q => q.no).filter(n => n === "1" || n === "2"), ["1"]);
  assert.ok(out.rows.find(r => r.문항 === "1")!.표시.includes("판독확인필요"));
  assert.ok(out.rows.find(r => r.문항 === "2")!.표시.includes("무응답")); // 확실히 빈칸이면 무응답
});

test("모든 판독 대조하기를 켜면 서술형을 뺀 모든 답이 대조 목록에 오른다", () => {
  const items = loadAnswerKey(SAMPLE_KEY_CSV);
  const answers = Object.fromEntries(items.map(it => [it.no, { answer: "③", confidence: 0.99, nameHits: 0 }]));
  const out = buildRows(items, { K7M: answers }, { assessmentId: "t", source: "t", reviewAll: true });
  assert.equal(out.readQueue.length, items.filter(it => it.kind !== "서술").length);
});

test("정답표에 페이지 열이 없어도 된다", () => {
  const key = "문항,유형,정답,배점,성취기준\n1,선택형,③,5,[6과14-01]\n2,OX,\"○,×\",5,[6과14-02]\n";
  const items = loadAnswerKey(key);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].pages, []);
});

test("비용 추정: 1536px A4 한 쪽은 과금 조각 4개", () => {
  assert.equal(imageTokens(1086, 1536), 4 * 258);
  assert.equal(imageTokens(1414, 2000), 6 * 258); // 예전 2000px은 6개
  assert.equal(imageTokens(300, 300), 258);
  const est = estimateOcr(24, [[1086, 1536], [1086, 1536], [1086, 1536]], 20);
  assert.equal(est.input, 24 * (3 * 1032 + 250 + 20 * 15));
  // 생각 토큰은 출력 요금으로 계산한다
  const price = { inputPerM: 0.3, outputPerM: 2.5, usdKrw: 1400 };
  assert.ok(costKrw({ input: 0, output: 0, thoughts: 1_000_000 }, price) === costKrw({ input: 0, output: 1_000_000, thoughts: 0 }, price));
});

test("교사 확인이 채점에 반영된다", () => {
  const items = loadAnswerKey(SAMPLE_KEY_CSV);
  const confident = Object.fromEntries(items.map(it => [it.no, { answer: "", confidence: 0.99, nameHits: 0 }]));
  const readings = { K7M: { ...confident, "1": { answer: "?", confidence: 0.3, nameHits: 0 }, "6": { answer: "빛과 열이 난다", confidence: 0.9, nameHits: 0 } } };
  let out = buildRows(items, readings, { assessmentId: "t", source: "t" });
  assert.equal(out.readQueue.length, 1);
  assert.equal(out.essayQueue.length, 1);
  assert.equal(out.rows.find(r => r.문항 === "6")!.점수, "");
  out = buildRows(items, readings, {
    assessmentId: "t", source: "t",
    readReview: { [reviewKey("K7M", "1")]: { fixed: "③" } },
    essayReview: { [reviewKey("K7M", "6")]: { final: 5 } },
  });
  assert.equal(out.readQueue.length, 1); // 처리한 판독도 목록에 남는다
  assert.equal(out.readQueue[0].reviewed, true);
  assert.equal(out.readQueue[0].answer, "?"); // 원래 판독을 보여 준다
  const r1 = out.rows.find(r => r.문항 === "1")!;
  assert.equal(r1.점수, "5");
  assert.ok(r1.표시.includes("판독수정"));
  const r6 = out.rows.find(r => r.문항 === "6")!;
  assert.equal(r6.점수, "5");
  assert.equal(r6.채점방식, "교사확정");
});

test("합성 반: 결과에 이름이 없고, 분석이 의미 있는 모양을 낸다", () => {
  const items = loadAnswerKey(SAMPLE_KEY_CSV);
  const { rows, names } = generateClass(items, { students: 25, seed: 7, assessmentId: "demo", confirmEssays: true });
  assert.equal(rows.length, 25 * 9);
  const text = JSON.stringify(rows);
  assert.ok(!names.some(n => text.includes(n) || text.includes(n.slice(1))));
  const stats = itemStats(rows);
  assert.ok(stats.every(s => s.정답률 != null)); // 서술형까지 확정되어 모두 계산됨
  const easy = stats.filter(s => s.난이도 === "하").map(s => s.정답률!);
  const hard = stats.filter(s => s.난이도 === "상").map(s => s.정답률!);
  assert.ok(Math.min(...easy) > Math.max(...hard) - 0.2); // 쉬운 문항이 대체로 정답률이 높다
  const d1 = distractors(rows).filter(d => d.문항 === "1" && !d.정답);
  assert.equal(d1[0].응답, "4"); // 흔한 오개념 쪽으로 오답이 몰린다
  const cls = classStandards(studentStandards(rows));
  assert.deepEqual(cls.map(c => c.성취기준), ["[6과14-01]", "[6과14-02]", "[6과14-03]", "[6과14-04]"]);
});

test("미확정 서술형이 있으면 정답률을 계산하지 않는다", () => {
  const items = loadAnswerKey(SAMPLE_KEY_CSV);
  const { rows } = generateClass(items, { students: 10, seed: 3, assessmentId: "demo" });
  const essay = itemStats(rows).find(s => s.유형 === "서술")!;
  assert.equal(essay.정답률, null);
  assert.equal(essay.비고, "교사 확정 후 계산");
});

test("sha256", async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
