// 학생 응답과 정답을 같은 형태로 정규화한다.
// 손글씨 OCR 결과는 '③', '3번', '3'처럼 표기가 제각각이므로 채점 전에 반드시 거친다.

const JAMO = "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ";
const SYL = "가나다라마바사아자차카타파하";

function zipMap(keys: string, values: string) {
  return Object.fromEntries([...keys].map((k, i) => [k, values[i]]));
}

const CIRCLED_NUM = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String.fromCharCode(0x2460 + i), String(i + 1)]));
const PAREN_NUM = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String.fromCharCode(0x2474 + i), String(i + 1)]));
const SYMBOL_MAP: Record<string, string> = {
  ...zipMap("㉠㉡㉢㉣㉤㉥㉦㉧㉨㉩㉪㉫㉬㉭", JAMO),
  ...zipMap("㈀㈁㈂㈃㈄㈅㈆㈇㈈㈉㈊㈋㈌㈍", JAMO),
  ...zipMap("㉮㉯㉰㉱㉲㉳㉴㉵㉶㉷㉸㉹㉺㉻", SYL),
  ...zipMap("㈎㈏㈐㈑㈒㈓㈔㈕㈖㈗㈘㈙㈚㈛", SYL),
};
const O_MARKS = new Set([..."○〇◯OoＯｏ"]);
const X_MARKS = new Set([..."×✕✗✘XxＸｘ"]);
// 단답형에서 용어 바로 앞뒤에 붙어도 되는 조사
const PARTICLES = new Set([..."과와이가을를은는랑도및"]);

export function nfc(text: string | null | undefined) {
  return (text ?? "").normalize("NFC").trim();
}

function replaceAll(text: string, map: Record<string, string>, pad = true) {
  let out = text;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(pad ? ` ${v} ` : v);
  return out;
}

/** '③', '3번', '1, 3' -> 숫자 목록 (등장 순서, 중복 제거) */
export function parseNumbers(text: string): number[] {
  const s = replaceAll(nfc(text), { ...CIRCLED_NUM, ...PAREN_NUM });
  const out: number[] = [];
  for (const m of s.match(/\d+/g) ?? []) if (!out.includes(Number(m))) out.push(Number(m));
  return out;
}

/** '㉡', 'ㄴ', '(가)', '㈎, ㈏' -> ['ㄴ'] / ['가'] / ['가', '나']. 기호가 아닌 글이 섞이면 [] */
export function parseSymbols(text: string): string[] {
  const s = replaceAll(nfc(text), SYMBOL_MAP).replace(/[()[\]{}<>,，、/·.\s]+/g, " ");
  const out: string[] = [];
  for (const tok of s.split(" ").filter(Boolean)) {
    let chars: string[];
    if ([...tok].every(ch => JAMO.includes(ch))) chars = [...tok];
    else if (tok.length === 1 && SYL.includes(tok)) chars = [tok];
    else return [];
    for (const ch of chars) if (!out.includes(ch)) out.push(ch);
  }
  return out;
}

/** '(1) ○ (2) ○ (3) ×' -> ['O', 'O', 'X'] */
export function parseOx(text: string): string[] {
  let s = nfc(text).replace(/[(（]\s*\d+\s*[)）]/g, " ").replace(/(^|\s)\d+\s*[.)]/g, " ");
  s = replaceAll(s, Object.fromEntries(Object.keys(PAREN_NUM).map(k => [k, " "])), false);
  const out: string[] = [];
  for (const ch of s) {
    if (O_MARKS.has(ch)) out.push("O");
    else if (X_MARKS.has(ch)) out.push("X");
  }
  return out;
}

function isHangul(ch: string) {
  return ch >= "가" && ch <= "힣";
}

function termRegex(term: string) {
  const chars = [...term.replace(/\s/g, "")].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(chars.join("\\s*"), "gi");
}

/** 단답형 용어가 답에 '단어로서' 들어 있는지. '물질' 안의 '물'은 인정하지 않는다. */
export function containsTerm(answer: string, alternatives: string[]) {
  const s = nfc(answer);
  const ok = (ch: string) => ch === "" || !isHangul(ch) || PARTICLES.has(ch);
  for (const alt of alternatives) {
    for (const m of s.matchAll(termRegex(alt))) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (ok(s[start - 1] ?? "") && ok(s[end] ?? "")) return true;
    }
  }
  return false;
}

/** '물|이산화 탄소=이산화탄소=CO2' -> [['물'], ['이산화 탄소', '이산화탄소', 'CO2']] */
export function parseShortKey(key: string): string[][] {
  return nfc(key)
    .split("|")
    .map(term => term.split("=").map(a => a.trim()).filter(Boolean))
    .filter(alts => alts.length);
}
