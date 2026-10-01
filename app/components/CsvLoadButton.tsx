"use client";

// 예전에 내려받은 채점 결과(응답_long.csv)나 다른 표를 현재 데이터로 불러온다.
// 파일은 이 브라우저에서만 읽고 서버로 보내지 않는다. 평가 결과면 평가 분석, 그 밖의 표는 시각화 · 예측으로 간다.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseCsv } from "../lib/assessment/csv";
import { isAssessmentCsv, setCurrentDataset } from "../lib/dataset";

export function CsvLoadButton({ label = "저장한 CSV 불러오기" }: { label?: string }) {
  const router = useRouter();
  const [error, setError] = useState("");

  async function load(file?: File) {
    if (!file) return;
    const text = await file.text();
    const table = parseCsv(text);
    if (!table.columns.length || !table.rows.length) {
      setError("표를 읽지 못했습니다. 첫 줄이 열 이름인 CSV 파일인지 확인하세요 (엑셀은 'CSV UTF-8'로 저장).");
      return;
    }
    setError("");
    const assessment = isAssessmentCsv(table.columns);
    // 학생 자료일 수 있으므로 실제 자료로 표시한다 (외부로 보내기 전에 한 번 더 확인하게 된다)
    setCurrentDataset({ name: file.name.replace(/\.csv$/i, ""), source: "가져옴", real: true, csv: text });
    router.push(assessment ? "/analysis" : "/studio");
  }

  return (
    <span className="csv-load">
      <label className="secondary-action file-button">{label}<input type="file" accept=".csv,text/csv" onChange={e => { load(e.target.files?.[0]); e.target.value = ""; }} /></label>
      {error && <span className="model-error">{error}</span>}
    </span>
  );
}
