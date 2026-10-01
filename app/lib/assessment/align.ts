// 스캔할 때 종이가 조금씩 밀리면 이름 줄도 같이 밀린다. 고정된 가림 띠는 그만큼 이름을 흘린다.
// 한 반의 1쪽은 인쇄된 글자 위치가 같으므로, 반 전체의 "가운데값" 모양과 비교해 쪽마다 세로 어긋남을 잰다.
// AI를 쓰지 않는 산술이고, 원본은 브라우저 밖으로 나가지 않는다.

import type { Region } from "./images.ts";

export const PROFILE_W = 120;
export const PROFILE_H = 170; // A4 비율. 한 행 = 페이지 높이의 약 0.6%
const TOP_ROWS = Math.round(PROFILE_H * 0.6);
const MAX_SHIFT_ROWS = 20; // ±약 12%

/** 페이지 위쪽 60%의 행별 잉크 비율 (가운데 60% 폭만 — 여백의 얼룩을 덜 탄다) */
export function rowProfile(gray: Uint8ClampedArray | number[], width = PROFILE_W, height = PROFILE_H, rgba = true): number[] {
  const step = rgba ? 4 : 1;
  const x0 = Math.round(width * 0.2);
  const x1 = Math.round(width * 0.8);
  const rows: number[] = [];
  for (let y = 0; y < Math.min(TOP_ROWS, height); y++) {
    let dark = 0;
    for (let x = x0; x < x1; x++) if (gray[(y * width + x) * step] < 150) dark++;
    rows.push(dark / (x1 - x0));
  }
  return rows;
}

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 겹치는 구간만의 피어슨 상관. 단순 곱의 합은 잉크가 많은 쪽으로 쏠려 엉뚱한 어긋남을 고른다 */
function correlation(a: number[], b: number[]) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : -1;
}

/** 쪽마다 반 전체 가운데값 대비 세로 어긋남 (페이지 높이 비율, +는 아래로 밀림) */
export function estimateShifts(profiles: number[][]): number[] {
  if (profiles.length < 3) return profiles.map(() => 0); // 비교할 대상이 적으면 재지 않는다
  const n = Math.min(...profiles.map(p => p.length));
  const ref = Array.from({ length: n }, (_, i) => median(profiles.map(p => p[i])));
  return profiles.map(p => {
    let best = 0;
    let bestScore = -Infinity;
    for (let k = -MAX_SHIFT_ROWS; k <= MAX_SHIFT_ROWS; k++) {
      const i0 = Math.max(0, -k);
      const i1 = Math.min(n, n - k);
      const score = correlation(p.slice(i0 + k, i1 + k), ref.slice(i0, i1)); // ref[i] ↔ p[i + k]
      if (score > bestScore) { bestScore = score; best = k; }
    }
    return best / PROFILE_H;
  });
}

/**
 * 가림 영역을 어긋난 만큼 늘린다. 원래 자리와 밀린 자리를 모두 덮고(합집합) 여유 1%를 더한다.
 * 절대 줄이지 않는다 — 측정이 틀려도 원래 영역은 항상 가려진다.
 */
export function shiftRegion([x0, y0, x1, y1]: Region, shift: number): Region {
  const top = Math.max(0, Math.min(y0, y0 + shift) - (shift ? 0.01 : 0));
  const bottom = Math.min(1, Math.max(y1, y1 + shift) + (shift ? 0.01 : 0));
  return [x0, top, x1, bottom];
}
