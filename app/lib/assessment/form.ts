// 양식 파일: 빈 시험지의 문항 칸 위치. 좌표는 빈 양식 한 쪽의 너비·높이에 대한 비율 [왼쪽, 위, 오른쪽, 아래].
// 빈 시험지(PDF)와 함께 쓰면 문제 글을 빼고 학생이 더한 잉크만 보고, 답 칸 조각만 판독 모델로 보낸다.

export type Box = [number, number, number, number];
export type CellKind = "write" | "pick" | "number";
export type FormCell = {
  page: number; // 0부터 (빈 양식 쪽 번호 = 학생 쪽 번호 - 1)
  kind: CellKind; // write = 손글씨 칸, pick = ( 가 / 나 ) 고르는 칸, number = 보기 번호 고르는 문항
  region: Box;
  options?: Record<string, Box>; // pick: 보기 낱말 위치, number: ①~⑤ 위치
  hint?: string; // 답의 종류만 (정답은 넣지 않는다)
};
export type FormLayout = { version: 1; form: string; pages: number; cells: Record<string, FormCell> };

export class FormError extends Error {}

const isBox = (b: unknown): b is Box =>
  Array.isArray(b) && b.length === 4 && b.every(v => typeof v === "number" && v >= -0.1 && v <= 1.1) && b[0] < b[2] && b[1] < b[3];

export function parseForm(text: string, itemNos: string[] = []): FormLayout {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FormError("양식 파일(JSON)을 읽을 수 없습니다.");
  }
  const f = raw as Partial<FormLayout>;
  if (f.version !== 1 || typeof f.pages !== "number" || f.pages < 1 || !f.cells || typeof f.cells !== "object") {
    throw new FormError("양식 파일 형식이 아닙니다 (version, pages, cells가 필요합니다).");
  }
  const errors: string[] = [];
  for (const [no, c] of Object.entries(f.cells)) {
    if (!Number.isInteger(c.page) || c.page < 0 || c.page >= f.pages) errors.push(`${no}: page가 0~${f.pages - 1} 밖입니다`);
    if (!["write", "pick", "number"].includes(c.kind)) errors.push(`${no}: kind는 write/pick/number 중 하나여야 합니다`);
    if (!isBox(c.region)) errors.push(`${no}: region 좌표가 올바르지 않습니다`);
    if (c.kind !== "write" && (!c.options || !Object.values(c.options).every(isBox) || !Object.keys(c.options).length)) errors.push(`${no}: 보기 위치(options)가 없습니다`);
  }
  const missing = itemNos.filter(no => !f.cells![no]);
  if (missing.length) errors.push(`정답표 문항 중 양식에 칸이 없는 문항: ${missing.join(", ")}`);
  if (errors.length) throw new FormError(`양식 파일 오류:\n${errors.join("\n")}`);
  return { version: 1, form: String(f.form ?? ""), pages: f.pages, cells: f.cells };
}
