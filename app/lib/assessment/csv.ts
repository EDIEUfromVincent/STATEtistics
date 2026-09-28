export type CsvRow = Record<string, string>;

/** 따옴표·줄바꿈을 처리하는 작은 CSV 파서 (BOM 제거) */
export function parseCsv(text: string): { columns: string[]; rows: CsvRow[] } {
  const records: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"' && quoted && source[i + 1] === '"') { value += '"'; i++; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { row.push(value); value = ""; continue; }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(value); value = "";
      if (row.some(cell => cell.length)) records.push(row);
      row = [];
      continue;
    }
    value += char;
  }
  if (value.length || row.length) { row.push(value); if (row.some(cell => cell.length)) records.push(row); }
  const columns = (records[0] ?? []).map(c => c.trim());
  return {
    columns,
    rows: records.slice(1).map(values => Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]))),
  };
}

function escape(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(columns: string[], rows: Array<Record<string, unknown>>) {
  return [columns.map(escape).join(","), ...rows.map(r => columns.map(c => escape(r[c])).join(","))].join("\r\n");
}
