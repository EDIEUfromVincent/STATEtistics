// "현재 데이터": 데이터 준비 단계(합성 생성·채점·가져오기)가 쓰고, 분석 단계(평가 분석·시각화)가 읽는다.
// 이 탭의 sessionStorage에만 둔다. 탭을 닫으면 사라지므로 공용 PC에 학생 자료가 남지 않는다.

import { useSyncExternalStore } from "react";
import { parseCsv } from "./assessment/csv";
import { LONG_COLUMNS } from "./assessment/records";

export type DatasetSource = "합성" | "채점" | "가져옴";
export type CurrentDataset = {
  name: string;
  source: DatasetSource;
  real: boolean; // 실제 학생 자료인가 (외부 전송 전에 경고한다)
  csv: string;
};

const KEY = "statetistic:currentDataset";
const EVENT = "statetistic:dataset";

export function isAssessmentCsv(columns: string[]) {
  return LONG_COLUMNS.every(c => columns.includes(c));
}

export function setCurrentDataset(dataset: CurrentDataset) {
  sessionStorage.setItem(KEY, JSON.stringify(dataset));
  window.dispatchEvent(new Event(EVENT));
}

export function clearCurrentDataset() {
  sessionStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}

/** JSON 문자열을 그대로 돌려주어야 useSyncExternalStore가 같은 값으로 인식한다 */
export function useCurrentDatasetRaw() {
  return useSyncExternalStore(subscribe, () => sessionStorage.getItem(KEY), () => null);
}

export function parseDataset(raw: string | null) {
  if (!raw) return null;
  try {
    const dataset = JSON.parse(raw) as CurrentDataset;
    const table = parseCsv(dataset.csv);
    return { ...dataset, ...table, assessment: isAssessmentCsv(table.columns) };
  } catch {
    return null;
  }
}

export type LoadedDataset = NonNullable<ReturnType<typeof parseDataset>>;
