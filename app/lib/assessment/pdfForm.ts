// 빈 시험지 PDF(글자 층이 있는 PDF)에서 칸 위치를 AI 없이 뽑는다.
//  - "( ____ )", "계절: ____" 같은 밑줄 = 쓰는 칸 (이름표 없이 이어진 밑줄 줄은 서술 한 칸으로 합침)
//  - "(     )" 빈 괄호 = 쓰는 칸,  "( A / B )" = 고르는 칸,  ①~⑤ = 선택형 보기
//  - 한 문항에 칸이 여러 개면 읽는 순서대로 6-1, 6-2 …
// 정답·해설 쪽(“정답”과 “채점”/“교사용”이 함께 있는 쪽)은 칸을 찾지 않고 글만 모은다.

import type { Box, FormCell, FormLayout } from "./form.ts";

export type PdfItem = { str: string; x: number; y: number; w: number; h: number }; // PDF 좌표(pt), y는 글자 기준선
export type PdfPage = { width: number; height: number; items: PdfItem[] };
type Char = { c: string; x0: number; x1: number; top: number; bottom: number };
type Line = { chars: Char[]; text: string; top: number; bottom: number };

const HEAD = /^\s*(?:\[[^\]]*\]\s*)?(L\d{1,2}|\d{1,2})\.\s/;
const CIRCLED = "①②③④⑤";

// 글자 폭 비율(한글·원문자 1, 그 밖은 좁게). 항목 하나 안에서만 나누므로 오차가 작다
const weight = (c: string) => (/[가-힣ㄱ-ㅎ①-⑳]/.test(c) ? 1 : c === " " ? 0.32 : c === "_" ? 0.5 : /[()/.,:]/.test(c) ? 0.35 : 0.56);

function lines(page: PdfPage): Line[] {
  const { width: W, height: H } = page;
  const rows: PdfItem[][] = [];
  for (const it of [...page.items].filter(i => i.str).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find(r => Math.abs(r[0].y - it.y) < Math.max(1.5, it.h * 0.3));
    if (row) row.push(it);
    else rows.push([it]);
  }
  return rows.map(row => {
    const chars: Char[] = [];
    let end: number | null = null;
    const rowH = Math.max(...row.map(i => i.h)) || 10;
    for (const it of row.sort((a, b) => a.x - b.x)) {
      // 공백만 있는 항목은 높이 0, 글자 1개로 오는데 폭은 실제 빈칸 너비다 → 폭만큼 공백 여러 칸으로 펼친다
      const blankRun = it.str.trim() === "";
      if (blankRun) it.h = rowH;
      const cs = blankRun ? Array(Math.max(1, Math.round(it.w / (rowH * 0.32)))).fill(" ") : [...it.str];
      const total = cs.reduce((s, c) => s + weight(c), 0) || 1;
      let x = it.x;
      const top = 1 - (it.y + it.h * 0.88) / H, bottom = 1 - (it.y - it.h * 0.22) / H;
      // pdfjs는 글자 사이 빈 공간을 공백 글자로 주지 않는다 → 틈만큼 공백을 채운다 ("(       )" 빈 괄호를 찾으려면 필요)
      if (end != null && it.x - end > it.h * 0.25) {
        const n = Math.max(1, Math.round((it.x - end) / (it.h * 0.32)));
        for (let k = 0; k < n; k++) chars.push({ c: " ", x0: (end + ((it.x - end) * k) / n) / W, x1: (end + ((it.x - end) * (k + 1)) / n) / W, top, bottom });
      }
      end = it.x + it.w;
      for (const c of cs) {
        const dx = (it.w * weight(c)) / total;
        chars.push({ c, x0: x / W, x1: (x + dx) / W, top, bottom });
        x += dx;
      }
    }
    return { chars, text: chars.map(c => c.c).join(""), top: Math.min(...chars.map(c => c.top)), bottom: Math.max(...chars.map(c => c.bottom)) };
  }).sort((a, b) => a.top - b.top || a.chars[0].x0 - b.chars[0].x0);
}

export const pageText = (page: PdfPage) => lines(page).map(l => l.text.trim()).filter(Boolean).join("\n");
export const isAnswerPage = (text: string) => text.includes("정답") && (text.includes("채점") || text.includes("교사용"));

const r4 = (b: number[]) => b.map(v => Math.round(v * 10000) / 10000) as Box;

type Found = { kind: "u" | "g" | "n"; box: Box; labeled?: boolean; options?: Record<string, Box>; option?: string; line: string };

export type PdfFormResult = {
  layout: FormLayout;
  lineOf: Record<string, string>; // 칸이 있는 문장 (정답표 초안을 만들 때 근거로 쓴다)
  questionText: string;
  answerText: string;
};

export function formFromPdf(pages: PdfPage[], title = ""): PdfFormResult {
  const cells: Record<string, FormCell> = {};
  const lineOf: Record<string, string> = {};
  const questionTexts: string[] = [];
  const answerTexts: string[] = [];
  let lastQuestionPage = 0;
  pages.forEach((page, pi) => {
    const ls = lines(page);
    const text = ls.map(l => l.text.trim()).filter(Boolean).join("\n");
    if (isAnswerPage(text)) { answerTexts.push(text); return; }
    questionTexts.push(`[${pi + 1}쪽]\n${text}`);
    lastQuestionPage = pi + 1;
    const heads: Array<{ no: string; top: number }> = [];
    for (const l of ls) {
      const m = HEAD.exec(l.text);
      if (m) heads.push({ no: m[1], top: l.top });
    }
    const owner = (top: number) => [...heads].reverse().find(h => h.top <= top + 0.002)?.no;
    const found = new Map<string, Found[]>();
    const add = (no: string, f: Found) => found.set(no, [...(found.get(no) ?? []), f]);
    for (const l of ls) {
      const no = owner(l.top);
      if (!no) continue;
      const t = l.text, cs = l.chars;
      // 1) 밑줄 칸
      for (let i = 0; i < cs.length; i++) {
        if (cs[i].c !== "_") continue;
        let j = i;
        while (j + 1 < cs.length && cs[j + 1].c === "_") j++;
        if (j - i >= 3) add(no, { kind: "u", box: [cs[i].x0, l.top, cs[j].x1, l.bottom], labeled: t.slice(0, i).trim() !== "", line: t.trim() });
        i = j;
      }
      // 2) 빈 괄호
      for (const m of t.matchAll(/\(\s{3,}\)/g)) add(no, { kind: "u", box: [cs[m.index!].x0, l.top, cs[m.index! + m[0].length - 1].x1, l.bottom], labeled: true, line: t.trim() });
      // 3) 고르는 칸 ( A / B )
      for (const m of t.matchAll(/\(\s*([^()_]+?\/[^()_]+?)\s*\)/g)) {
        const options: Record<string, Box> = {};
        let pos = m.index! + m[0].indexOf(m[1]);
        for (const w of m[1].split("/").map(s => s.trim()).filter(Boolean)) {
          const k = t.indexOf(w, pos);
          if (k < 0) continue;
          options[w] = [cs[k].x0, l.top, cs[k + w.length - 1].x1, l.bottom];
          pos = k + w.length;
        }
        add(no, { kind: "g", box: [cs[m.index!].x0, l.top, cs[m.index! + m[0].length - 1].x1, l.bottom], options, line: t.trim() });
      }
      // 4) 선택형 보기 ①~⑤ (앞이 한글이면 본문 속 번호라 뺀다)
      cs.forEach((c, k) => {
        const idx = CIRCLED.indexOf(c.c);
        if (idx >= 0 && !/[가-힣]/.test(t[k - 1] ?? "")) add(no, { kind: "n", box: [c.x0, c.top, c.x1, c.bottom], option: String(idx + 1), line: t.trim() });
      });
    }
    for (const { no, top: headTop } of heads) {
      const list = (found.get(no) ?? []).sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
      const nums = list.filter(f => f.kind === "n");
      const merged: Found[] = [];
      for (const f of list.filter(x => x.kind !== "n")) {
        const prev = merged.at(-1);
        // 이름표 없이 바로 아래로 이어지는 긴 밑줄 줄 = 서술 한 칸
        if (prev && f.kind === "u" && !f.labeled && prev.kind === "u" && Math.abs(prev.box[0] - f.box[0]) < 0.06 && f.box[1] - prev.box[3] < 0.02 && f.box[1] > prev.box[1] && f.box[2] - f.box[0] > 0.3) {
          prev.box = [Math.min(prev.box[0], f.box[0]), prev.box[1], Math.max(prev.box[2], f.box[2]), f.box[3]];
          continue;
        }
        merged.push({ ...f });
      }
      if (nums.length && !merged.length) {
        cells[no] = {
          page: pi, kind: "number",
          options: Object.fromEntries(nums.map(n => [n.option!, r4([n.box[0] - 0.008, n.box[1] - 0.006, n.box[2] + 0.008, n.box[3] + 0.006])])),
          // 학생은 보기에 ○표도 하고 문제 끝에 번호를 쓰기도 한다 → 문제 줄부터 보기 끝까지
          region: r4([0.04, headTop - 0.004, 0.96, Math.max(...nums.map(n => n.box[3])) + 0.012]),
          hint: "보기 번호 ①~⑤ 중 하나. 보기에 ○표를 했거나 문제 옆·괄호에 번호를 적었을 수 있음",
        };
        lineOf[no] = nums[0].line;
      }
      merged.forEach((f, k) => {
        const id = merged.length === 1 ? no : `${no}-${k + 1}`;
        const [x0, y0, x1, y1] = f.box;
        cells[id] = f.kind === "g"
          ? { page: pi, kind: "pick", region: r4([x0 - 0.02, y0 - 0.012, x1 + 0.02, y1 + 0.012]), options: Object.fromEntries(Object.entries(f.options!).map(([w, b]) => [w, r4([b[0] - 0.006, b[1] - 0.008, b[2] + 0.006, b[3] + 0.008])])) }
          // 쓰는 칸: 글씨가 줄 위로 얹히므로 위로 넉넉히
          : { page: pi, kind: "write", region: r4([x0 - 0.02, y0 - 0.022, x1 + 0.02, y1 + 0.002]) };
        lineOf[id] = f.line;
      });
    }
  });
  return {
    layout: { version: 1, form: title, pages: lastQuestionPage, cells },
    lineOf,
    questionText: questionTexts.join("\n\n"),
    answerText: answerTexts.join("\n\n"),
  };
}

/** 브라우저: PDF 파일 → pdfjs 글자 항목 */
export async function readPdfPages(file: File): Promise<PdfPage[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      const items = (await page.getTextContent()).items.flatMap(it =>
        "str" in it ? [{ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) }] : []);
      pages.push({ width, height, items });
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
