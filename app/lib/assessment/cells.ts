// 양식 기반 칸 판독 (브라우저 안에서만 실행).
// 가린 학생 쪽 위에 빈 양식을 겹쳐 → 칸마다 학생이 더한 잉크를 세고 → 잉크가 있는 칸만
// "빈 양식 칸 | 학생 칸" 한 쌍으로 잘라 판독 모델에 보낸다. 문제 글·이름·쪽 전체는 보내지 않는다.
// 파이썬 벤치(학생 4명, 76칸)에서 검증한 값을 그대로 옮겼다.

import type { Box, FormCell } from "./form.ts";

export type Gray = { w: number; h: number; d: Uint8Array };
export type Registration = { score: number; sc: number; x0: number; y0: number }; // x0, y0는 쪽 너비·높이 비율

const gray = (w: number, h: number, fill = 255): Gray => ({ w, h, d: new Uint8Array(w * h).fill(fill) });

/** 넓이 평균으로 줄이기 */
export function shrink(g: Gray, w: number, h: number): Gray {
  const out = gray(w, h);
  const sx = g.w / w, sy = g.h / h;
  for (let y = 0; y < h; y++) {
    const ya = Math.floor(y * sy), yb = Math.max(ya + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const xa = Math.floor(x * sx), xb = Math.max(xa + 1, Math.floor((x + 1) * sx));
      let s = 0, n = 0;
      for (let yy = ya; yy < yb && yy < g.h; yy++) for (let xx = xa; xx < xb && xx < g.w; xx++) { s += g.d[yy * g.w + xx]; n++; }
      out.d[y * w + x] = n ? s / n : 255;
    }
  }
  return out;
}

/** 쌍선형 크기 바꾸기 (빈 양식을 스캔 크기에 맞출 때) */
export function resize(g: Gray, w: number, h: number): Gray {
  if (w < g.w / 1.5 || h < g.h / 1.5) return shrink(g, w, h);
  const out = gray(w, h);
  const sx = (g.w - 1) / Math.max(1, w - 1), sy = (g.h - 1) / Math.max(1, h - 1);
  for (let y = 0; y < h; y++) {
    const fy = y * sy, y0 = Math.floor(fy), y1 = Math.min(g.h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x * sx, x0 = Math.floor(fx), x1 = Math.min(g.w - 1, x0 + 1), tx = fx - x0;
      const top = g.d[y0 * g.w + x0] * (1 - tx) + g.d[y0 * g.w + x1] * tx;
      const bot = g.d[y1 * g.w + x0] * (1 - tx) + g.d[y1 * g.w + x1] * tx;
      out.d[y * w + x] = top * (1 - ty) + bot * ty;
    }
  }
  return out;
}

type Cand = Registration & { dxs: number; dys: number };

/** 폭 W로 줄여 (배율 × 이동) 조합마다 겹침 점수를 잰다. 빈 양식의 잉크 픽셀만 훑는다 */
function scoreGrid(scan: Gray, blank: Gray, W: number, scales: number[], shifts: (sc: number) => Array<[number, number]>): Cand[] {
  const H = Math.round((W * scan.h) / scan.w);
  const s = shrink(scan, W, H).d.map(v => (v < 170 ? 1 : 0));
  const out: Cand[] = [];
  for (const sc of scales) {
    const bw = Math.floor(W * sc), bh = Math.floor(H * sc);
    const b = shrink(blank, bw, bh);
    const ink: number[] = [];
    for (let i = 0; i < b.d.length; i++) if (b.d[i] < 170) ink.push(i);
    for (const [dx, dy] of shifts(sc)) {
      const oy = Math.floor((H - bh) / 2) + dy, ox = Math.floor((W - bw) / 2) + dx;
      const ys = Math.max(0, oy), xs = Math.max(0, ox), ye = Math.min(H, oy + bh), xe = Math.min(W, ox + bw);
      if (ye - ys < H * 0.7 || xe - xs < W * 0.7) continue;
      let hit = 0;
      for (const i of ink) {
        const y = oy + Math.floor(i / bw), x = ox + (i % bw);
        if (y >= ys && y < ye && x >= xs && x < xe) hit += s[y * W + x];
      }
      out.push({ score: hit / (ink.length + 1), sc, x0: ox / W, y0: oy / H, dxs: dx / W, dys: dy / H });
    }
  }
  return out;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * 빈 양식을 얼마나 줄이고 옮겨야 스캔과 겹치는지.
 * ① 폭 160px에서 배율 0.86~1.06 × 이동 ±12px 전수 탐색 → 서로 다른 후보 5개
 * ② 폭 400px에서 후보 주변(배율 ±0.02, 이동 ±4px)을 다시 재서 가장 좋은 것.
 * 인쇄 글자가 적은 쪽은 ①만으로는 엉뚱한 곳에 맞춰지는 일이 있었다.
 */
export function register(scan: Gray, blank: Gray): Registration {
  const grid: Array<[number, number]> = [];
  for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) grid.push([dx, dy]);
  const coarse = scoreGrid(scan, blank, 160, Array.from({ length: 21 }, (_, k) => round2(0.86 + k * 0.01)), () => grid).sort((a, b) => b.score - a.score);
  const picks: Cand[] = [];
  for (const c of coarse) {
    if (picks.every(p => Math.abs(p.sc - c.sc) > 0.015 || Math.abs(p.dxs - c.dxs) > 0.02 || Math.abs(p.dys - c.dys) > 0.02)) picks.push(c);
    if (picks.length === 5) break;
  }
  let best: Registration = coarse[0] ?? { score: 0, sc: 1, x0: 0, y0: 0 };
  let bestFine = -1;
  const FW = 400, FH = Math.round((FW * scan.h) / scan.w);
  for (const c of picks) {
    const cx = Math.round(c.dxs * FW), cy = Math.round(c.dys * FH);
    const near: Array<[number, number]> = [];
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) near.push([cx + dx, cy + dy]);
    const fine = scoreGrid(scan, blank, FW, [-0.02, -0.01, 0, 0.01, 0.02].map(d => round2(c.sc + d)), () => near);
    for (const f of fine) if (f.score > bestFine) { bestFine = f.score; best = { score: f.score, sc: f.sc, x0: f.x0, y0: f.y0 }; }
  }
  return best;
}

/** 스캔과 같은 크기 캔버스에 빈 양식을 맞춰 놓는다 */
export function place(blank: Gray, w: number, h: number, reg: Registration): Gray {
  const out = gray(w, h);
  const b = resize(blank, Math.floor(w * reg.sc), Math.floor(h * reg.sc));
  const ox = Math.floor(reg.x0 * w), oy = Math.floor(reg.y0 * h);
  for (let y = 0; y < b.h; y++) {
    const ty = oy + y;
    if (ty < 0 || ty >= h) continue;
    for (let x = 0; x < b.w; x++) {
      const tx = ox + x;
      if (tx >= 0 && tx < w) out.d[ty * w + tx] = b.d[y * b.w + x];
    }
  }
  return out;
}

/** k×k 최솟값 필터 (인쇄 글자를 조금 두껍게 → 살짝 어긋나도 인쇄 글자가 잉크로 세어지지 않게) */
export function minFilter(g: Gray, k: number): Gray {
  const r = Math.floor(k / 2);
  const tmp = gray(g.w, g.h), out = gray(g.w, g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    let m = 255;
    for (let xx = Math.max(0, x - r); xx <= Math.min(g.w - 1, x + r); xx++) m = Math.min(m, g.d[y * g.w + xx]);
    tmp.d[y * g.w + x] = m;
  }
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    let m = 255;
    for (let yy = Math.max(0, y - r); yy <= Math.min(g.h - 1, y + r); yy++) m = Math.min(m, tmp.d[yy * g.w + x]);
    out.d[y * g.w + x] = m;
  }
  return out;
}

export type PreparedPage = { scan: Gray; placed: Gray; printed: Uint8Array; reg: Registration; shifts: Map<string, Shift> };
export type Shift = { dx: number; dy: number };

export function preparePage(scan: Gray, blankAtScanHeight: Gray, known?: Registration): PreparedPage {
  const reg = known ?? register(scan, blankAtScanHeight);
  const placed = place(blankAtScanHeight, scan.w, scan.h, reg);
  const printed = minFilter(placed, 5).d.map(v => (v < 235 ? 1 : 0));
  return { scan, placed, printed, reg, shifts: new Map() };
}

/**
 * 겹침 품질: 빈 양식의 인쇄 픽셀 가운데 스캔에서도 (±2px 안에) 어둡게 찍힌 비율.
 * 양식 판이 다르거나(다른 해 시험지, 문항 순서가 바뀐 판) 정렬이 틀리면 낮게 나온다.
 */
export function matchQuality(p: PreparedPage) {
  const { w, h } = p.scan;
  let total = 0, hit = 0;
  for (let y = 2; y < h - 2; y += 3) for (let x = 2; x < w - 2; x += 3) {
    if (p.placed.d[y * w + x] >= 160) continue;
    total++;
    let found = false;
    for (let yy = y - 2; yy <= y + 2 && !found; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (p.scan.d[yy * w + xx] < 170) { found = true; break; }
    if (found) hit++;
  }
  return total ? hit / total : 0;
}

/** 빈 양식 비율 좌표 → 스캔 픽셀 좌표 */
export function toPx(p: PreparedPage, box: Box): [number, number, number, number] {
  const { sc, x0, y0 } = p.reg, { w, h } = p.scan;
  return [Math.floor((x0 + box[0] * sc) * w), Math.floor((y0 + box[1] * sc) * h), Math.floor((x0 + box[2] * sc) * w), Math.floor((y0 + box[3] * sc) * h)];
}

/** 칸 주변 인쇄 글자로 겹침을 다시 맞춘다: ±18px 안에서 인쇄 픽셀과 스캔의 어두운 픽셀이 가장 많이 겹치는 위치 */
export function refine(p: PreparedPage, box: Box, search = 18, pad = 40): Shift {
  const key = box.join(",");
  const known = p.shifts.get(key);
  if (known) return known;
  const [x0, y0, x1, y1] = toPx(p, box);
  const X0 = Math.max(0, x0 - pad), Y0 = Math.max(0, y0 - pad), X1 = Math.min(p.scan.w, x1 + pad), Y1 = Math.min(p.scan.h, y1 + pad);
  let best = -1, bdx = 0, bdy = 0;
  // 큰 칸(선택형 문항 전체)은 점을 건너뛰며 잰다: 약 4만 점이면 충분하다
  const step = Math.max(1, Math.floor(Math.sqrt(((X1 - X0) * (Y1 - Y0)) / 40000)));
  for (let dy = -search; dy <= search; dy += 2) {
    for (let dx = -search; dx <= search; dx += 2) {
      if (Y0 - dy < 0 || X0 - dx < 0 || Y1 - dy > p.scan.h || X1 - dx > p.scan.w) continue;
      let hit = 0, total = 0;
      for (let y = Y0; y < Y1; y += step) for (let x = X0; x < X1; x += step) {
        if (p.placed.d[(y - dy) * p.scan.w + (x - dx)] < 160) {
          total++;
          if (p.scan.d[y * p.scan.w + x] < 160) hit++;
        }
      }
      const score = hit / (total + 1);
      if (score > best) { best = score; bdx = dx; bdy = dy; }
    }
  }
  const shift = { dx: bdx, dy: bdy };
  p.shifts.set(key, shift);
  return shift;
}

const DARK = 195; // 연필처럼 흐린 글씨도 잡는다

function added(p: PreparedPage, x: number, y: number, dx: number, dy: number, dark = DARK) {
  const px = x - dx, py = y - dy;
  const printed = px >= 0 && py >= 0 && px < p.scan.w && py < p.scan.h ? p.printed[py * p.scan.w + px] : 0;
  return p.scan.d[y * p.scan.w + x] < dark && !printed;
}

/** 아주 흐린 연필 글씨까지 잡는 밝기. "확실한 빈칸"은 이 기준에서도 잉크가 없어야 한다 (흐린 '다'를 빈칸으로 처리한 일) */
export const FAINT = 215;

/** 칸 안에 학생이 더한 잉크 픽셀 수 (주변 3×3 중 5개 이상이 잉크인 점만 세어 티끌을 뺀다) */
export function ink(p: PreparedPage, box: Box, dark = DARK) {
  const { dx, dy } = refine(p, box);
  const [x0, y0, x1, y1] = toPx(p, box);
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return 0;
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x0 + x, Y = y0 + y;
    if (X >= 0 && Y >= 0 && X < p.scan.w && Y < p.scan.h && added(p, X, Y, dx, dy, dark)) a[y * w + x] = 1;
  }
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!a[y * w + x]) continue;
    let nb = 0;
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (yy >= 0 && xx >= 0 && yy < h && xx < w) nb += a[yy * w + xx];
    if (nb >= 5) n++;
  }
  return n;
}

/** 고르는 칸: 보기마다 잉크를 세어 하나가 확실히 많으면 그 보기. 비슷하면 null(판독 모델에 묻는다) */
export function pickByInk(p: PreparedPage, cell: FormCell, gate = 40, dominance = 1.6): { pick: string | null; inks: Record<string, number> } {
  // 보기 번호(①~⑤)는 글자 상자가 작아서 체크(V)의 꼬리가 밖으로 나간다 → 왼쪽·위아래로 조금 넓혀 센다
  const grow = ([x0, y0, x1, y1]: Box): Box => (cell.kind === "number" ? [x0 - 0.02, y0 - 0.012, x1 + 0.012, y1 + 0.012] : [x0, y0, x1, y1]);
  const inks = Object.fromEntries(Object.entries(cell.options ?? {}).map(([k, b]) => [k, ink(p, grow(b))]));
  const ranked = Object.entries(inks).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < gate) return { pick: "", inks };
  if (ranked.length > 1 && ranked[0][1] < dominance * Math.max(1, ranked[1][1])) return { pick: null, inks };
  return { pick: ranked[0][0], inks };
}

function crop(g: Gray, x0: number, y0: number, x1: number, y1: number): Gray {
  const out = gray(x1 - x0, y1 - y0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (x >= 0 && y >= 0 && x < g.w && y < g.h) out.d[(y - y0) * out.w + (x - x0)] = g.d[y * g.w + x];
  }
  return out;
}

/** 어두운 쪽·밝은 쪽 1%를 잘라 명암을 넓힌다 (흐린 연필 글씨를 진하게) */
export function autocontrast(g: Gray, cutoff = 0.01): Gray {
  const hist = new Array(256).fill(0);
  for (const v of g.d) hist[v]++;
  const cut = g.d.length * cutoff;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) <= cut) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) <= cut) hi--;
  if (hi <= lo) return g;
  return { w: g.w, h: g.h, d: g.d.map(v => Math.max(0, Math.min(255, Math.round(((v - lo) * 255) / (hi - lo))))) };
}

/**
 * 판독 모델에 보낼 "빈 양식 칸 | 학생 칸" 한 쌍.
 * ① 칸 겹침 보정을 조각에도 적용 ② 칸에 걸친 손글씨 획은 칸 밖으로 삐져나가도 통째로 포함
 *   (받침·윗획이 잘려 '낮아→날아'가 되던 문제) ③ 무게중심이 칸 밖인 획은 이웃 칸 글씨라 뺀다.
 */
export function cellPair(p: PreparedPage, box: Box): { blank: Gray; student: Gray } {
  const { dx, dy } = refine(p, box);
  const [x0, y0, x1, y1] = toPx(p, box);
  const w = x1 - x0, h = y1 - y0;
  const X0 = Math.max(0, x0 - Math.floor(w / 3)), Y0 = Math.max(0, y0 - h), X1 = Math.min(p.scan.w, x1 + Math.floor(w / 3)), Y1 = Math.min(p.scan.h, y1 + h);
  const W = X1 - X0, H = Y1 - Y0;
  // 더해진 잉크 → 2×2 열림(티끌 제거) → 7×7 팽창 → 연결 요소
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (added(p, X0 + x, Y0 + y, dx, dy)) a[y * W + x] = 1;
  const er = new Uint8Array(W * H);
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) er[y * W + x] = a[y * W + x] & a[y * W + x + 1] & a[(y + 1) * W + x] & a[(y + 1) * W + x + 1];
  const op = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!er[y * W + x]) continue;
    for (let yy = y; yy <= Math.min(H - 1, y + 1); yy++) for (let xx = x; xx <= Math.min(W - 1, x + 1); xx++) op[yy * W + xx] = 1;
  }
  const dil = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!op[y * W + x]) continue;
    for (let yy = Math.max(0, y - 3); yy <= Math.min(H - 1, y + 3); yy++) for (let xx = Math.max(0, x - 3); xx <= Math.min(W - 1, x + 3); xx++) dil[yy * W + xx] = 1;
  }
  const label = new Int32Array(W * H);
  let bx0 = x0, by0 = y0, bx1 = x1, by1 = y1;
  let next = 0;
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (!dil[start] || label[start]) continue;
    next++;
    label[start] = next;
    stack.push(start);
    let n = 0, sx = 0, sy = 0, mx0 = W, my0 = H, mx1 = 0, my1 = 0, touchesCore = false;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % W, y = (i - x) / W;
      n++; sx += x; sy += y;
      mx0 = Math.min(mx0, x); my0 = Math.min(my0, y); mx1 = Math.max(mx1, x); my1 = Math.max(my1, y);
      if (X0 + x >= x0 && X0 + x < x1 && Y0 + y >= y0 && Y0 + y < y1) touchesCore = true;
      for (const j of [i - W, i + W, x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1]) {
        if (j >= 0 && j < W * H && dil[j] && !label[j]) { label[j] = next; stack.push(j); }
      }
    }
    if (!touchesCore || n < 30) continue;
    const cx = X0 + sx / n, cy = Y0 + sy / n;
    if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue; // 이웃 칸 글씨
    bx0 = Math.min(bx0, X0 + mx0 - 6); by0 = Math.min(by0, Y0 + my0 - 6);
    bx1 = Math.max(bx1, X0 + mx1 + 6); by1 = Math.max(by1, Y0 + my1 + 6);
  }
  bx0 = Math.max(X0, bx0); by0 = Math.max(Y0, by0); bx1 = Math.min(X1, bx1); by1 = Math.min(Y1, by1);
  return {
    student: autocontrast(crop(p.scan, bx0, by0, bx1, by1)),
    blank: crop(p.placed, bx0 - dx, by0 - dy, bx1 - dx, by1 - dy),
  };
}

/**
 * 인쇄 글자를 지우고 학생이 더한 획만 남긴 조각. 문제를 볼 수 없으므로 판독 모델이 문제를 풀어 답을 적을 수 없다.
 * 선택형에서 보기 위치에 표시가 없는데 정답이 읽힌 칸을 다시 확인할 때 쓴다.
 */
export function strokesOnly(p: PreparedPage, box: Box): Gray {
  const { dx, dy } = refine(p, box);
  const [x0, y0, x1, y1] = toPx(p, box);
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x0 + x, Y = y0 + y;
    if (X >= 0 && Y >= 0 && X < p.scan.w && Y < p.scan.h && added(p, X, Y, dx, dy)) a[y * w + x] = 1;
  }
  // 스캔 잡티를 지운다: 주변 3×3 중 5개 이상이 잉크인 점만 남기고, 획 덩어리(7×7로 이어 붙인 것)가 작으면 버린다
  const solid = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (!a[y * w + x]) continue;
    let nb = 0;
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) nb += a[yy * w + xx];
    if (nb >= 5) solid[y * w + x] = 1;
  }
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!solid[y * w + x]) continue;
    for (let yy = Math.max(0, y - 3); yy <= Math.min(h - 1, y + 3); yy++) for (let xx = Math.max(0, x - 3); xx <= Math.min(w - 1, x + 3); xx++) dil[yy * w + xx] = 1;
  }
  const label = new Int32Array(w * h), keep = new Uint8Array(w * h);
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (!dil[start] || label[start]) continue;
    const members: number[] = [];
    const stack = [start];
    label[start] = ++next;
    let ink = 0;
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      ink += solid[i];
      const x = i % w;
      for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) if (j >= 0 && j < w * h && dil[j] && !label[j]) { label[j] = next; stack.push(j); }
    }
    if (ink >= 60) for (const i of members) if (solid[i]) keep[i] = 1;
  }
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  const out = gray(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!keep[y * w + x]) continue;
    out.d[y * w + x] = p.scan.d[(y0 + y) * p.scan.w + (x0 + x)];
    bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
  }
  if (bx1 < 0) return gray(64, 32);
  return autocontrast(crop(out, bx0 - 8, by0 - 8, bx1 + 9, by1 + 9));
}

/** 흰 바탕 (인쇄를 지운 조각과 짝지을 "빈 양식") */
export const blankLike = (g: Gray): Gray => gray(g.w, g.h);

/** 큰 칸(선택형 문항 전체)은 그대로 자른다. 판독 모델 비용을 줄이려고 폭 900px 이하로 */
export function regionPair(p: PreparedPage, box: Box): { blank: Gray; student: Gray } {
  const { dx, dy } = refine(p, box);
  const [x0, y0, x1, y1] = toPx(p, box);
  return { student: autocontrast(crop(p.scan, x0, y0, x1, y1)), blank: crop(p.placed, x0 - dx, y0 - dy, x1 - dx, y1 - dy) };
}

// ---- 브라우저 도우미 ------------------------------------------------------

export function grayFromRgba(data: Uint8ClampedArray, w: number, h: number): Gray {
  const d = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  return { w, h, d };
}

export async function grayFromBlob(blob: Blob): Promise<Gray> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const g = grayFromRgba(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  c.width = c.height = 0;
  return g;
}

/** 조각을 판독에 알맞은 크기로: 작은 칸은 정수배로 키워 폭 약 700px, 큰 칸은 폭 900px 이하로 줄인다 */
export function fitForReading(g: Gray): Gray {
  if (g.w > 900) return resize(g, 900, Math.max(1, Math.round((g.h * 900) / g.w)));
  const k = Math.max(1, Math.floor(700 / Math.max(1, g.w)));
  return k === 1 ? g : resize(g, g.w * k, g.h * k);
}

export function grayToPng(g: Gray): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = g.w;
  c.height = g.h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(g.w, g.h);
  for (let i = 0; i < g.w * g.h; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g.d[i];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve, reject) => c.toBlob(b => { c.width = c.height = 0; if (b) resolve(b); else reject(new Error("조각 저장 실패")); }, "image/png"));
}

/** 빈 시험지 PDF의 한 쪽을 스캔과 같은 높이로 그리고, 스캔 너비의 흰 캔버스 가운데에 놓는다 */
export async function renderBlankPage(pdf: File, pageIndex: number, w: number, h: number): Promise<Gray> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await pdf.arrayBuffer()) }).promise;
  try {
    if (pageIndex >= doc.numPages) throw new Error(`빈 시험지 PDF에 ${pageIndex + 1}쪽이 없습니다.`);
    const page = await doc.getPage(pageIndex + 1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: h / base.height });
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, w, h);
    const pc = document.createElement("canvas");
    pc.width = Math.round(viewport.width);
    pc.height = Math.round(viewport.height);
    await page.render({ canvas: pc, viewport }).promise;
    ctx.drawImage(pc, Math.floor((w - pc.width) / 2), 0);
    const g = grayFromRgba(ctx.getImageData(0, 0, w, h).data, w, h);
    c.width = c.height = pc.width = pc.height = 0;
    return g;
  } finally {
    await doc.destroy();
  }
}
