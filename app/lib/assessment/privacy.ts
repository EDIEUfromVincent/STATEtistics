// 학생 번호·가명 코드와 이름 가리기.
// 이름은 받지 않는다: 교사는 학생 수와 결시 번호만 넣고, 화면에는 "13번 · K3M"처럼 번호와 가명만 나온다.
// (답에 쓴 이름을 가리고 싶을 때만 이름 목록을 선택으로 받는다. 그 목록은 화면·결과·서버에 나가지 않는다.)

import { parseCsv, toCsv } from "./csv.ts";

export type Student = { number: number; name: string; code: string; absent: boolean };

const LETTERS = "ACDEFHJKMNPRTUVWXY"; // 헷갈리는 I, O, L, B, G, S, Q, Z 제외
const DIGITS = "345679"; // 0, 1, 2, 8 제외 (O, I, Z, B와 혼동)

function pick(alphabet: string) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return alphabet[buf[0] % alphabet.length];
}

/** 출석번호와 무관한 무작위 코드. 번호 순서대로 매기면 명렬표만으로 되돌릴 수 있다. */
export function newCode(taken: Set<string>) {
  for (;;) {
    const code = pick(LETTERS) + pick(DIGITS) + pick(LETTERS);
    if (!taken.has(code)) return code;
  }
}

export function createRoster(names: string[], existing: Student[] = []): Student[] {
  const clean = names.map(n => n.normalize("NFC").trim()).filter(Boolean);
  const dup = [...new Set(clean.filter((n, i) => clean.indexOf(n) !== i))];
  if (dup.length) throw new Error(`같은 이름이 둘 이상 있습니다: ${dup.join(", ")} — 구분되게 적어 주세요 (예: 김민수A)`);
  const old = new Map(existing.map(s => [s.name, s.code]));
  const taken = new Set(old.values());
  return clean.map((name, i) => {
    const code = old.get(name) ?? newCode(taken);
    taken.add(code);
    return { number: i + 1, name, code, absent: existing.find(s => s.name === name)?.absent ?? false };
  });
}

/** 이름 없이 번호만으로 학생 목록을 만든다. 같은 번호의 코드·결시는 유지한다. */
export function numberRoster(count: number, absent: number[] = [], existing: Student[] = []): Student[] {
  if (!Number.isInteger(count) || count < 1 || count > 60) throw new Error("학생 수는 1~60 사이로 적어 주세요");
  const bad = absent.filter(n => !Number.isInteger(n) || n < 1 || n > count);
  if (bad.length) throw new Error(`결시 번호가 학생 수 범위 밖입니다: ${bad.join(", ")}`);
  const old = new Map(existing.map(s => [s.number, s.code]));
  const taken = new Set(old.values());
  return Array.from({ length: count }, (_, i) => {
    const number = i + 1;
    const code = old.get(number) ?? newCode(taken);
    taken.add(code);
    return { number, name: "", code, absent: absent.includes(number) };
  });
}

/** "3, 17 21" → [3, 17, 21] */
export function parseNumberList(text: string) {
  return [...new Set((text.match(/\d+/g) ?? []).map(Number))].sort((a, b) => a - b);
}

/** 화면 표시용: "13번 · K3M" */
export const studentLabel = (s: Pick<Student, "number" | "code">) => `${s.number}번 · ${s.code}`;

export function rosterToCsv(students: Student[]) {
  return toCsv(["번호", "코드", "결시"], students.map(s => ({ 번호: s.number, 코드: s.code, 결시: s.absent ? "Y" : "" })));
}

export function parseRoster(text: string): Student[] {
  const { columns, rows } = parseCsv(text);
  if (!["번호", "코드"].every(c => columns.includes(c))) throw new Error("학생 목록 파일에는 번호·코드 열이 있어야 합니다");
  // 예전 명부 파일에 이름 열이 있어도 이름은 읽지 않는다
  return rows.map(r => ({
    number: Number(r["번호"]), name: "", code: r["코드"].trim(), absent: (r["결시"] ?? "").trim().toUpperCase() === "Y",
  }));
}

export function present(students: Student[]) {
  return [...students].sort((a, b) => a.number - b.number).filter(s => !s.absent);
}

/** (패턴, 성명여부). 성명과, 세 글자 이상 이름의 '이름만' 형태. 긴 것부터. */
export function namePatterns(names: string[]): Array<[string, boolean]> {
  const out = new Map<string, boolean>();
  for (const raw of names) {
    const n = raw.trim();
    if (n.length >= 2) out.set(n, true);
    if (n.length >= 3 && !out.has(n.slice(1))) out.set(n.slice(1), false);
  }
  return [...out].sort((a, b) => b[0].length - a[0].length);
}

/**
 * 학생 이름을 [이름]으로 바꾼다. 일반 단어와 겹쳐도 과하게 가리는 쪽을 택한다.
 * 성명은 어디에 붙어 있어도 가리고, '이름만'은 앞 글자가 한글이 아닐 때만 가린다.
 */
export function maskNames(text: string, names: string[]): { text: string; hits: string[] } {
  const hits: string[] = [];
  let out = text;
  for (const [pat, full] of namePatterns(names)) {
    const escaped = pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp((full ? "" : "(?<![가-힣])") + escaped, "g");
    if (rx.test(out)) {
      hits.push(pat);
      out = out.replace(rx, "[이름]");
    }
  }
  return { text: out, hits };
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
