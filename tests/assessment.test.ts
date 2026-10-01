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
    difficulty: "", content: "", mappingStatus: "", hint: "", parsed: parseAnswer(kind, answer), ...extra,
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
    assert.deepEqual(Object.keys(spec).sort(), ["choices", "hint", "kind", "no", "ox"]);
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
  // 저장 파일에는 번호·코드·결시만 남고 이름은 남지 않는다
  assert.deepEqual(parseRoster(rosterToCsv(roster)), roster.map(s => ({ ...s, name: "" })));
  assert.ok(!rosterToCsv(roster).includes(roster[0].name));
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

test("스캔 위치 맞춤: 밀린 쪽을 찾아 가림 띠를 늘리고, 절대 줄이지 않는다", async () => {
  const { estimateShifts, shiftRegion, PROFILE_H } = await import("../app/lib/assessment/align.ts");
  // 인쇄된 줄 3개가 있는 1쪽 모양. 한 명은 10행(약 6%) 아래로 밀렸다
  const base = Array.from({ length: 102 }, (_, i) => ([20, 21, 30, 45, 46, 70, 88].includes(i) ? 0.8 : 0.02));
  const shifted = (k: number) => base.map((_, i) => base[i - k] ?? 0.02);
  const profiles = [base, base, shifted(10), base, shifted(-4), base];
  const shifts = estimateShifts(profiles);
  assert.equal(Math.round(shifts[2] * PROFILE_H), 10);
  assert.equal(Math.round(shifts[4] * PROFILE_H), -4);
  assert.equal(shifts[0], 0);
  const band: [number, number, number, number] = [0, 0, 1, 0.16];
  assert.ok(shiftRegion(band, 0.06)[3] >= 0.22); // 아래로 밀리면 늘린다
  assert.equal(shiftRegion(band, -0.05)[3], band[3] + 0.01); // 위로 밀려도 원래 영역은 그대로 덮는다
  assert.deepEqual(shiftRegion(band, 0), band);
  assert.deepEqual(estimateShifts([base, shifted(8)]), [0, 0]); // 비교 대상이 적으면 재지 않는다
});

test("판독 문항 번호 맞추기: 흔한 변형을 정답표 번호로", async () => {
  const { normalizeItemNo } = await import("../app/api/assessment/_gemini.ts");
  const known = new Set(["1", "6-1", "14-3", "L3", "L5-2"]);
  assert.equal(normalizeItemNo("6-1", known), "6-1");
  assert.equal(normalizeItemNo("6-1번", known), "6-1");
  assert.equal(normalizeItemNo("6(1)", known), "6-1");
  assert.equal(normalizeItemNo("6 - 1", known), "6-1");
  assert.equal(normalizeItemNo("문항 1", known), "1");
  assert.equal(normalizeItemNo("l3", known), "L3");
  assert.equal(normalizeItemNo("L5(2)", known), "L5-2");
  assert.equal(normalizeItemNo("7", known), null);
});

// ---- 양식 기반 칸 판독 --------------------------------------------------------
import { decide, jamoDistance, SURE, UNSURE } from "../app/lib/assessment/decide.ts";
import { FormError, parseForm } from "../app/lib/assessment/form.ts";

const KEY6 = loadAnswerKey(`문항,유형,정답,배점,성취기준,채점기준
6-2,단답,높아=높아지=높아져=높아지고=높,1,[6과13-01],
1,선택형,③,1,[6과13-01],
L3,서술,,2,[6과13-02],자전축 기울기와 공전을 함께 쓰면 2점`);
const it = (no: string) => KEY6.find(i => i.no === no)!;

test("자모 거리", () => {
  assert.equal(jamoDistance("높아", "높아"), 0);
  assert.equal(jamoDistance("놓아", "높아"), 1);
  assert.ok(jamoDistance("겨울", "높아") > 2);
});

test("두 판독이 같고 정답이면 자동 정답, 정답과 한두 자모 차이면 교사 확인", () => {
  assert.equal(decide(it("6-2"), "높아", "높아").confidence, SURE);
  // 두 모델이 똑같이 '놓아'로 잘못 읽은 실제 사례: 정답과 가까우므로 자동 오답으로 처리하지 않는다
  assert.equal(decide(it("6-2"), "놓아", "놓아").confidence, UNSURE);
  assert.equal(decide(it("6-2"), "놓아진다", "놓아진다").confidence, UNSURE);
  // 확실히 다른 오답은 자동 오답
  assert.equal(decide(it("6-2"), "낮아", "낮아").confidence, UNSURE); // 낮아↔높아는 자모 2개 차이 → 교사
  assert.equal(decide(it("6-2"), "겨울", "겨울").confidence, SURE);
});

test("두 판독이 다르거나 하나가 실패하면 교사 확인", () => {
  assert.equal(decide(it("6-2"), "높아", "놀아").confidence, UNSURE);
  assert.equal(decide(it("6-2"), "높아", null).confidence, UNSURE);
  assert.equal(decide(it("1"), "③", "3").confidence, SURE); // 표기만 다르고 같은 번호
  assert.equal(decide(it("1"), "③", "②").confidence, UNSURE);
  assert.equal(decide(it("6-2"), "", "").confidence, SURE); // 둘 다 빈칸
});

test("서술형은 옮겨 적은 글만 넘기고 점수는 교사가 정한다", () => {
  const d = decide(it("L3"), "자전축이 기울어져서", "자전축이 기울어서");
  assert.equal(d.answer, "자전축이 기울어져서");
  assert.match(d.note, /다른 판독/);
});

test("양식 파일 검사", () => {
  const ok = JSON.stringify({ version: 1, form: "t", pages: 2, cells: { "6-2": { page: 1, kind: "write", region: [0.3, 0.6, 0.5, 0.65] }, "1": { page: 0, kind: "number", region: [0.04, 0.2, 0.96, 0.5], options: { "1": [0.06, 0.48, 0.09, 0.5] } } } });
  assert.equal(Object.keys(parseForm(ok, ["6-2", "1"]).cells).length, 2);
  assert.throws(() => parseForm(ok, ["6-2", "1", "L3"]), FormError); // 정답표 문항에 칸이 없음
  assert.throws(() => parseForm(JSON.stringify({ version: 1, pages: 1, cells: { a: { page: 3, kind: "write", region: [0, 0, 1, 1] } } })), FormError);
  assert.throws(() => parseForm("{"), FormError);
});

import { accuracyLabel, reasonOf } from "../app/lib/assessment/confidence.ts";
import { BLANK_FIX } from "../app/lib/assessment/records.ts";

test("교사가 빈칸으로 고치면 무응답으로 채점한다", () => {
  const rows = buildRows(KEY6, { A1B: { "6-2": { answer: "높아", confidence: 0.3, nameHits: 0 } } }, {
    assessmentId: "t", source: "", readReview: { "A1B|6-2": { fixed: BLANK_FIX } },
  }).rows;
  const r = rows.find(x => x.문항 === "6-2")!;
  assert.equal(r.응답, "");
  assert.equal(r.정오, "X");
  assert.match(r.표시, /판독수정/);
});

test("교사 확인 이유와 잰 정확도", () => {
  assert.equal(reasonOf("확인 판독(claude-sonnet-5-5)은 \"놓아\"로 읽음", false), "verifier");
  assert.equal(reasonOf("정답과 한두 자모 차이 — 잘못 읽었을 수 있음", false), "near");
  assert.equal(reasonOf("", true), "auto");
  assert.match(accuracyLabel("verifier"), /^77\.8% \(36칸 중 28칸\)$/);
  assert.match(accuracyLabel("marks"), /표본 적음/);
  assert.equal(accuracyLabel("form"), "측정 전");
});

test("서술형: 옮겨 적은 글을 고쳐도 판독 확인 목록에 오르지 않고, 교사 점수가 있어야 확정된다", () => {
  const readings = { A1B: { L3: { answer: "자전축이 기울어져서", confidence: 1, nameHits: 0 } } };
  const base = { assessmentId: "t", source: "", readReview: { "A1B|L3": { fixed: "자전축이 기울어진 채 공전해서" } } };
  const pending = buildRows(KEY6, readings, base);
  assert.equal(pending.readQueue.filter(q => q.no === "L3").length, 0);
  assert.equal(pending.essayQueue[0].answer, "자전축이 기울어진 채 공전해서");
  assert.equal(pending.rows.find(r => r.문항 === "L3")!.정오, "");
  const scored = buildRows(KEY6, readings, { ...base, essayReview: { "A1B|L3": { final: 1.5 } } });
  const row = scored.rows.find(r => r.문항 === "L3")!;
  assert.equal(row.점수, "1.5");
  assert.equal(row.채점방식, "교사확정");
});

import { numberRoster, parseNumberList, studentLabel } from "../app/lib/assessment/privacy.ts";
import { scoreSheet } from "../app/lib/assessment/records.ts";

test("이름 없이 번호로 학생 목록을 만든다", () => {
  const r = numberRoster(5, parseNumberList("3, 5"));
  assert.deepEqual(r.map(s => s.number), [1, 2, 3, 4, 5]);
  assert.deepEqual(r.filter(s => s.absent).map(s => s.number), [3, 5]);
  assert.ok(r.every(s => s.name === "" && /^[A-Z]\d[A-Z]$/.test(s.code)));
  assert.equal(studentLabel(r[0]), `1번 · ${r[0].code}`);
  // 다시 만들어도 같은 번호는 같은 코드
  assert.deepEqual(numberRoster(6, [], r).slice(0, 5).map(s => s.code), r.map(s => s.code));
  assert.throws(() => numberRoster(3, [4]));
  // 예전 명부 파일의 이름 열은 읽지 않는다
  assert.equal(parseRoster("번호,이름,코드,결시\n1,홍길동,A3C,\n").at(0)!.name, "");
});

test("결과는 번호 순서이고 학생별 점수표는 미확정 칸을 비운다", () => {
  const readings = {
    Z9Z: { "6-2": { answer: "높아", confidence: 1, nameHits: 0 }, "1": { answer: "③", confidence: 1, nameHits: 0 }, L3: { answer: "글", confidence: 1, nameHits: 0 } },
    A3C: { "6-2": { answer: "낮아", confidence: 1, nameHits: 0 }, "1": { answer: "②", confidence: 0.3, nameHits: 0 }, L3: { answer: "", confidence: 1, nameHits: 0 } },
  };
  const { rows } = buildRows(KEY6, readings, { assessmentId: "t", source: "", numbers: { Z9Z: 2, A3C: 7 } });
  assert.deepEqual([...new Set(rows.map(r => r.학생번호))], ["2", "7"]);
  const sheet = scoreSheet(rows, KEY6);
  assert.deepEqual(sheet.rows.map(r => r.번호), ["2", "7"]);
  const first = sheet.rows[0];
  assert.equal(first["L3번(2점)"], ""); // 서술형 미확정
  assert.equal(first["합계"], "2");
  assert.equal(first["미확정"], "1");
  assert.equal(sheet.rows[1]["1번(1점)"], ""); // 판독 확인 대기
});
