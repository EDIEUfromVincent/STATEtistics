// 정답표(이원분류표) CSV를 읽고 검증한다.
// 정답표는 교사가 브라우저에서 불러오는 입력이다. 출판사 정답표는 저장소에 넣지 않는다.

import { parseCsv } from "./csv.ts";
import { nfc, parseNumbers, parseOx, parseShortKey, parseSymbols } from "./normalize.ts";

export const ITEM_KINDS = ["선택형", "복수선택", "기호", "OX", "단답", "서술"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
// 페이지 열은 없어도 된다. 판독은 학생 한 명의 모든 쪽을 한 번에 보고 문항을 찾는다.
const REQUIRED = ["문항", "유형", "정답", "배점", "성취기준"];
const STANDARD_RE = /^\[\d[가-힣]+\d{2}-\d{2}\]$/;

export type Item = {
  no: string;
  pages: number[]; // 참고용 (있으면 학생 1명 쪽수의 기본값을 정하는 데만 쓴다)
  kind: ItemKind;
  answer: string;
  points: number;
  standard: string;
  choices: number;
  rubric: string;
  domain: string;
  difficulty: string;
  content: string;
  mappingStatus: string;
  parsed: number[] | string[] | string[][] | null;
};

export class AnswerKeyError extends Error {}

export function parseAnswer(kind: ItemKind, answer: string): Item["parsed"] {
  if (kind === "선택형" || kind === "복수선택") return parseNumbers(answer);
  if (kind === "기호") return parseSymbols(answer);
  if (kind === "OX") return parseOx(answer);
  if (kind === "단답") return parseShortKey(answer);
  return null; // 서술형은 루브릭으로 채점
}

export function loadAnswerKey(text: string, name = "정답표"): Item[] {
  const { columns, rows } = parseCsv(text);
  const missing = REQUIRED.filter(c => !columns.includes(c));
  if (missing.length) throw new AnswerKeyError(`${name}: 필수 열이 없습니다: ${missing.join(", ")}`);

  const items: Item[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  rows.forEach((r, index) => {
    const where = `${index + 2}행`;
    const no = nfc(r["문항"]);
    const kind = nfc(r["유형"]) as ItemKind;
    const standard = nfc(r["성취기준"]);
    if (!no) { errors.push(`${where}: 문항 번호가 비어 있습니다`); return; }
    if (seen.has(no)) errors.push(`${where}: 문항 ${no}이 중복됩니다`);
    seen.add(no);
    if (!ITEM_KINDS.includes(kind)) { errors.push(`${where}: 유형 '${kind}'은 ${ITEM_KINDS.join(", ")} 중 하나여야 합니다`); return; }
    if (!STANDARD_RE.test(standard)) errors.push(`${where}: 성취기준 '${standard}' 형식이 아닙니다 (예: [6과14-02])`);
    const pages = nfc(r["페이지"]).split(/[,+\s]+/).filter(Boolean).map(Number);
    const points = Number(nfc(r["배점"]));
    if (pages.some(p => !Number.isInteger(p) || p < 1) || !Number.isFinite(points) || points <= 0) {
      errors.push(`${where}: 배점은 0보다 큰 숫자, 페이지(선택)는 2 또는 2,3처럼 적어야 합니다`);
      return;
    }
    const answer = nfc(r["정답"]);
    const parsed = parseAnswer(kind, answer);
    if (kind !== "서술" && !parsed?.length) errors.push(`${where}: 정답 '${answer}'을 ${kind}으로 해석할 수 없습니다`);
    if (kind === "선택형" && parsed && parsed.length !== 1) errors.push(`${where}: 선택형 정답은 하나여야 합니다 (복수 정답이면 유형을 복수선택으로)`);
    if (kind === "서술" && !nfc(r["채점기준"])) errors.push(`${where}: 서술형은 채점기준이 필요합니다`);
    items.push({
      no, pages, kind, answer, points, standard, parsed,
      choices: Number(nfc(r["보기수"])) || 0,
      rubric: nfc(r["채점기준"]),
      domain: nfc(r["행동영역"]),
      difficulty: nfc(r["난이도"]),
      content: nfc(r["평가내용"]),
      mappingStatus: nfc(r["매핑상태"]),
    });
  });
  if (errors.length) throw new AnswerKeyError(`${name} 오류:\n${errors.join("\n")}`);
  return items;
}

export function pageCount(items: Item[]) {
  return Math.max(0, ...items.flatMap(it => it.pages));
}

/** OCR 요청용 문항 정보. 정답은 절대 넣지 않는다. */
export function ocrSpec(it: Item) {
  return { no: it.no, kind: it.kind, choices: it.choices, ox: it.kind === "OX" ? (it.parsed as string[]).length : 0 };
}
