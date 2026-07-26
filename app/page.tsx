"use client";

import JSZip from "jszip";
import { useMemo, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import {
  datasetCatalog,
  datasetToCsv,
  downloadBlob,
  generateDatasets,
  type DatasetId,
  type GeneratedDataset,
} from "./lib/generator";

const schools = [
  { value: "초등", label: "초등학교 (3~6학년)", grades: [3, 4, 5, 6] },
  { value: "중학", label: "중학교", grades: [1, 2, 3] },
  { value: "고등", label: "고등학교", grades: [1, 2, 3] },
  { value: "특수", label: "특수교육 (초·중·고 통합)", grades: [1, 2, 3, 4, 5, 6] },
];
const subjects = ["국어", "수학", "과학", "사회", "영어", "실과", "음악", "미술", "체육"];

export default function GeneratorPage() {
  const [school, setSchool] = useState("초등");
  const [subject, setSubject] = useState("국어");
  const [grade, setGrade] = useState(3);
  const [classNo, setClassNo] = useState(3);
  const [unit, setUnit] = useState(1);
  const [students, setStudents] = useState(26);
  const [weeks, setWeeks] = useState(8);
  const [tests, setTests] = useState(3);
  const [seed, setSeed] = useState(2026);
  const [selected, setSelected] = useState<DatasetId[]>(datasetCatalog.map(v => v.id));
  const [generated, setGenerated] = useState<GeneratedDataset[]>([]);
  const [activeId, setActiveId] = useState<DatasetId>("achievement");
  const [copied, setCopied] = useState(false);

  const grades = useMemo(() => schools.find(v => v.value === school)?.grades ?? [1, 2, 3], [school]);
  const active = generated.find(v => v.id === activeId) ?? generated[0];

  function toggle(id: DatasetId) {
    setSelected(current => current.includes(id) ? current.filter(v => v !== id) : [...current, id]);
  }

  function build() {
    if (!selected.length) return;
    const result = generateDatasets({ school, subject, grade, classNo, unit, students, weeks, tests, seed }, selected);
    setGenerated(result);
    setActiveId(result[0].id);
    const csv = datasetToCsv(result[0]);
    localStorage.setItem("statetistic:lastCsv", csv);
    localStorage.setItem("statetistic:lastName", result[0].filename);
  }

  async function downloadAll() {
    const zip = new JSZip();
    generated.forEach(dataset => zip.file(dataset.filename, `\uFEFF${datasetToCsv(dataset)}`));
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `STATEtistic_${school}_${subject}_${seed}.zip`, "application/zip");
  }

  async function copyCsv() {
    if (!active) return;
    await navigator.clipboard.writeText(datasetToCsv(active));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  function openStudio() {
    if (!active) return;
    localStorage.setItem("statetistic:lastCsv", datasetToCsv(active));
    localStorage.setItem("statetistic:lastName", active.filename);
    window.location.href = "/studio";
  }

  return (
    <main>
      <AppHeader
        active="generate"
        title="합성 데이터 생성기"
        description="조건을 설계하고 8종의 교육·행동 데이터를 CSV로 생성해 나만의 분석을 시작하세요."
      />
      <div className="generator-shell">
        <aside className="generator-panel">
          <div className="panel-kicker">01 · DATA CONTEXT</div>
          <div className="form-grid">
            <SelectField label="학교급" value={school} onChange={value => { setSchool(value); setGrade(schools.find(v => v.value === value)?.grades[0] ?? 1); }} options={schools.map(v => ({ value: v.value, label: v.label }))} />
            <SelectField label="과목" value={subject} onChange={setSubject} options={subjects.map(value => ({ value, label: value }))} />
            <SelectField label="학년" value={String(grade)} onChange={value => setGrade(Number(value))} options={grades.map(value => ({ value: String(value), label: `${value}학년` }))} />
            <NumberField label="반" value={classNo} onChange={setClassNo} min={1} max={20} />
            <NumberField label="단원" value={unit} onChange={setUnit} min={1} max={20} />
            <NumberField label="학생 수" value={students} onChange={setStudents} min={8} max={200} />
            <NumberField label="운영 주차" value={weeks} onChange={setWeeks} min={2} max={24} />
            <NumberField label="평가 회차" value={tests} onChange={setTests} min={1} max={8} />
            <NumberField label="난수 시드" value={seed} onChange={setSeed} min={1} max={999999} full />
          </div>

          <div className="panel-kicker dataset-kicker">02 · DATASETS <span>{selected.length}/8</span></div>
          <div className="dataset-selector">
            {datasetCatalog.map(item => (
              <label key={item.id} className={selected.includes(item.id) ? "dataset-option checked" : "dataset-option"}>
                <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
                <span className="checkmark">{selected.includes(item.id) ? "✓" : ""}</span>
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </label>
            ))}
          </div>
          <div className="select-actions">
            <button onClick={() => setSelected(datasetCatalog.map(v => v.id))}>전체 선택</button>
            <button onClick={() => setSelected([])}>전체 해제</button>
          </div>
          <button className="primary-action" disabled={!selected.length} onClick={build}>데이터 생성</button>
          <button className="secondary-action" disabled={!generated.length} onClick={downloadAll}>선택 데이터셋 ZIP 다운로드</button>
          <details className="generator-principle">
            <summary>데이터 생성 원리</summary>
            <p>선택한 조건과 시드를 기반으로 재현 가능한 합성 데이터를 만듭니다. 실제 개인 정보는 사용하지 않으며, 시각화·통계·머신러닝 실습에 바로 쓸 수 있습니다.</p>
          </details>
        </aside>

        <section className="generator-workspace">
          {!active ? (
            <div className="empty-generator">
              <div className="empty-mark">S</div>
              <h2>분석 가능한 데이터를 직접 설계하세요</h2>
              <p>좌측에서 조건과 데이터셋을 고른 뒤 <b>데이터 생성</b>을 누르세요.</p>
              <div className="empty-steps"><span>1 조건 설정</span><i>→</i><span>2 CSV 생성</span><i>→</i><span>3 시각화·예측</span></div>
            </div>
          ) : (
            <>
              <div className="result-summary">
                <div><span>GENERATED</span><strong>{generated.reduce((sum, d) => sum + d.rows.length, 0).toLocaleString()}</strong><small>총 데이터 행</small></div>
                <div><span>DATASETS</span><strong>{generated.length}</strong><small>생성된 CSV</small></div>
                <div><span>ACTIVE</span><strong>{active.rows.length.toLocaleString()}</strong><small>{active.label} 행</small></div>
                <button onClick={openStudio}>시각화 스튜디오에서 열기 <b>↗</b></button>
              </div>
              <div className="dataset-tabs">
                {generated.map(dataset => <button key={dataset.id} className={dataset.id === active.id ? "active" : ""} onClick={() => setActiveId(dataset.id)}>{dataset.label}<small>{dataset.rows.length}</small></button>)}
              </div>
              <div className="data-table-card">
                <header>
                  <div><h2>{active.label}</h2><p>{active.description} · 미리보기 {Math.min(50, active.rows.length)}행</p></div>
                  <div className="table-actions">
                    <button onClick={() => downloadBlob(`\uFEFF${datasetToCsv(active)}`, active.filename, "text/csv;charset=utf-8")}>CSV 다운로드</button>
                    <button onClick={copyCsv}>{copied ? "복사됨 ✓" : "CSV 복사"}</button>
                  </div>
                </header>
                <div className="table-scroll">
                  <table>
                    <thead><tr>{active.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
                    <tbody>{active.rows.slice(0, 50).map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function NumberField({ label, value, onChange, min, max, full }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; full?: boolean }) {
  return <label className={`field ${full ? "full" : ""}`}><span>{label}</span><input type="number" value={value} min={min} max={max} onChange={event => onChange(Math.max(min, Math.min(max, Number(event.target.value))))} /></label>;
}
