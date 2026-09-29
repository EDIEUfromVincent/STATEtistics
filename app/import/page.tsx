"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { parseCsv } from "../lib/assessment/csv";
import { isAssessmentCsv, setCurrentDataset } from "../lib/dataset";

type Preview = { name: string; text: string; columns: string[]; rows: Array<Record<string, string>> };

// 들여오는 곳은 ① 데이터 준비뿐이다. 파일은 이 브라우저에서만 읽고 서버로 보내지 않는다.
export default function ImportPage() {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [real, setReal] = useState(true);
  const [error, setError] = useState("");

  async function handleFile(file?: File) {
    if (!file) return;
    const text = await file.text();
    const table = parseCsv(text);
    if (!table.columns.length || !table.rows.length) {
      setPreview(null);
      setError("표를 읽지 못했습니다. 첫 줄이 열 이름인 CSV(쉼표 구분) 파일인지 확인하세요. 엑셀은 'CSV UTF-8'로 저장하면 됩니다.");
      return;
    }
    setError("");
    setPreview({ name: file.name.replace(/\.csv$/i, ""), text, ...table });
  }

  function use() {
    if (!preview) return;
    setCurrentDataset({ name: preview.name, source: "가져옴", real, csv: preview.text });
    router.push(isAssessmentCsv(preview.columns) ? "/analysis" : "/studio");
  }

  const assessment = preview ? isAssessmentCsv(preview.columns) : false;

  return (
    <main>
      <AppHeader active="import" title="CSV 가져오기" description="가지고 있는 표를 현재 데이터로 등록합니다. 파일은 이 브라우저에서만 읽습니다." />
      <div className="grading-page">
        <section className="grading-card">
          <header><span>1</span><h3>파일 선택</h3><p>첫 줄이 열 이름인 CSV 파일. 예전에 내려받은 응답_long.csv를 넣으면 평가 분석으로, 그 밖의 표는 시각화 · 예측으로 갑니다.</p></header>
          <label className="upload-drop">
            <input type="file" accept=".csv,text/csv" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
            <b>CSV 선택</b>
            <span>{preview ? `${preview.name} · ${preview.rows.length.toLocaleString()}행 × ${preview.columns.length}열` : "파일은 서버로 올라가지 않습니다"}</span>
          </label>
          {error && <div className="model-error">{error}</div>}
        </section>

        {preview && <section className="grading-card">
          <header><span>2</span><h3>확인하고 등록</h3><p>{assessment ? "평가 응답 형식입니다. 평가 분석에서 성취기준별로 봅니다." : "일반 표입니다. 시각화 · 예측에서 봅니다."}</p></header>
          <div className="table-scroll small-table"><table><thead><tr>{preview.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{preview.rows.slice(0, 8).map((r, i) => <tr key={i}>{preview.columns.map(c => <td key={c}>{r[c]}</td>)}</tr>)}</tbody></table></div>
          <label className="approve-check"><input type="checkbox" checked={real} onChange={e => setReal(e.target.checked)} /> 실제 학생 자료입니다 (외부로 보내기 전에 한 번 더 확인합니다)</label>
          <div className="grading-actions">
            <label>데이터 이름 <input className="cell-input wide" value={preview.name} onChange={e => setPreview({ ...preview, name: e.target.value })} /></label>
            <button className="primary-action" onClick={use}>현재 데이터로 등록하고 분석하기 →</button>
          </div>
        </section>}
      </div>
    </main>
  );
}
