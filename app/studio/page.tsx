"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "../components/AppHeader";

type Row = Record<string, string>;
type ParsedCsv = { name: string; columns: string[]; rows: Row[] };
type ModelResult = {
  task: string;
  target: string;
  rows: number;
  features: number;
  device: string;
  metrics: Record<string, number>;
  predictions: Array<{ actual: string | number; predicted: string | number; confidence?: number }>;
};

function parseCsv(text: string, name = "dataset.csv"): ParsedCsv {
  const records: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
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
  if (value.length || row.length) { row.push(value); records.push(row); }
  const columns = records[0] ?? [];
  return {
    name,
    columns,
    rows: records.slice(1).map(values => Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]))),
  };
}

function isNumericColumn(rows: Row[], column: string) {
  const present = rows.map(row => row[column]).filter(value => value !== "");
  return present.length > 0 && present.filter(value => Number.isFinite(Number(value))).length / present.length > 0.9;
}

export default function StudioPage() {
  const [data, setData] = useState<ParsedCsv | null>(null);
  const [xColumn, setXColumn] = useState("");
  const [yColumn, setYColumn] = useState("");
  const [chartType, setChartType] = useState("scatter");
  const [target, setTarget] = useState("");
  const [task, setTask] = useState("classification");
  const [service, setService] = useState<"checking" | "online" | "offline">("checking");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ModelResult | null>(null);
  const [error, setError] = useState("");
  const [serviceMessage, setServiceMessage] = useState("");
  const [requiresAccessKey, setRequiresAccessKey] = useState(false);
  const [accessKey, setAccessKey] = useState(() =>
    typeof window === "undefined" ? "" : localStorage.getItem("statetistic:accessKey") ?? "",
  );

  useEffect(() => {
    const stored = localStorage.getItem("statetistic:lastCsv");
    if (stored) loadData(parseCsv(stored, localStorage.getItem("statetistic:lastName") ?? "generated.csv"));
    checkService();
  }, []);

  const numericColumns = useMemo(() => data?.columns.filter(column => isNumericColumn(data.rows, column)) ?? [], [data]);

  function loadData(parsed: ParsedCsv) {
    setData(parsed);
    const numeric = parsed.columns.filter(column => isNumericColumn(parsed.rows, column));
    setXColumn(parsed.columns[0] ?? "");
    setYColumn(numeric[0] ?? parsed.columns[1] ?? "");
    setTarget(parsed.columns[parsed.columns.length - 1] ?? "");
    setResult(null);
    setError("");
  }

  async function handleFile(file?: File) {
    if (!file) return;
    loadData(parseCsv(await file.text(), file.name));
  }

  async function checkService() {
    setService("checking");
    setServiceMessage("");
    try {
      const response = await fetch("/api/tabpfn/health", { cache: "no-store" });
      const payload = await response.json();
      setRequiresAccessKey(Boolean(payload.requires_access_key));
      setServiceMessage(payload.error ?? "");
      setService(response.ok ? "online" : "offline");
    } catch {
      setServiceMessage("STATEtistic 서버의 TabPFN API에 연결할 수 없습니다.");
      setService("offline");
    }
  }

  function updateAccessKey(value: string) {
    setAccessKey(value);
    localStorage.setItem("statetistic:accessKey", value);
  }

  async function runTabPFN() {
    if (!data || !target) return;
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/tabpfn/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessKey ? { "X-STATEtistic-Access-Key": accessKey } : {}),
        },
        body: JSON.stringify({ rows: data.rows, target, task, test_size: 0.25 }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "TabPFN 분석에 실패했습니다.");
      setResult(payload);
      setService("online");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "TabPFN 분석 요청에 실패했습니다.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <main>
      <AppHeader active="studio" title="Visualization & TabPFN Studio" description="생성한 CSV 또는 내 데이터를 불러와 즉석에서 탐색하고 표형 데이터 예측을 실행하세요." />
      <div className="studio-page">
        <section className="studio-intro">
          <div>
            <span className="studio-kicker">STATEtistic / ANALYSIS WORKBENCH</span>
            <h2>CSV에서 인사이트까지,<br /><em>한 화면에서.</em></h2>
          </div>
          <label className="upload-drop">
            <input type="file" accept=".csv,text/csv" onChange={event => handleFile(event.target.files?.[0])} />
            <b>CSV 불러오기</b>
            <span>{data ? `${data.name} · ${data.rows.length.toLocaleString()}행 × ${data.columns.length}열` : "파일을 선택하거나 생성기에서 데이터를 보내세요"}</span>
          </label>
        </section>

        {!data ? (
          <section className="studio-empty"><span>CSV</span><h3>분석할 데이터가 아직 없습니다</h3><p>CSV를 업로드하거나 데이터 생성기에서 “시각화 스튜디오에서 열기”를 선택하세요.</p><Link href="/">데이터 생성기로 이동</Link></section>
        ) : (
          <div className="studio-grid">
            <section className="studio-card visualize-card">
              <header><div><span>01</span><h3>나만의 시각화</h3><p>열과 차트 유형을 자유롭게 조합하세요.</p></div></header>
              <div className="viz-controls">
                <label>차트<select value={chartType} onChange={event => setChartType(event.target.value)}><option value="scatter">산점도</option><option value="line">선 그래프</option><option value="bar">그룹 평균 막대</option><option value="histogram">히스토그램</option></select></label>
                <label>X축<select value={xColumn} onChange={event => setXColumn(event.target.value)}>{data.columns.map(column => <option key={column}>{column}</option>)}</select></label>
                <label>Y축<select value={yColumn} onChange={event => setYColumn(event.target.value)}>{numericColumns.map(column => <option key={column}>{column}</option>)}</select></label>
              </div>
              <CustomChart data={data} xColumn={xColumn} yColumn={yColumn} type={chartType} />
              <div className="chart-caption"><span>{xColumn}</span><i>×</i><span>{yColumn}</span><small>최대 120개 관측치 표시</small></div>
            </section>

            <section className="studio-card tabpfn-card">
              <header>
                <div><span>02</span><h3>TabPFN API 예측</h3><p>API 키는 서버에만 보관되고 분석은 이 화면에서 끝납니다.</p></div>
                <button className={`service-pill ${service}`} onClick={checkService}><i />{service === "online" ? "API 연결됨" : service === "checking" ? "확인 중" : "설정 필요"}</button>
              </header>
              <div className="model-controls">
                <label>문제 유형<select value={task} onChange={event => setTask(event.target.value)}><option value="classification">분류</option><option value="regression">회귀</option></select></label>
                <label>예측할 목표 열<select value={target} onChange={event => setTarget(event.target.value)}>{data.columns.map(column => <option key={column}>{column}</option>)}</select></label>
              </div>
              {requiresAccessKey && <label className="access-key-control">분석 액세스 코드<input type="password" autoComplete="off" value={accessKey} onChange={event => updateAccessKey(event.target.value)} placeholder="이 브라우저에만 저장됩니다" /></label>}
              <div className="model-spec">
                <div><span>TRAIN</span><b>75%</b></div><div><span>TEST</span><b>25%</b></div><div><span>FEATURES</span><b>{Math.max(0, data.columns.length - 1)}</b></div><div><span>ROWS</span><b>{data.rows.length}</b></div>
              </div>
              <button className="run-model" disabled={running || service === "offline" || (requiresAccessKey && !accessKey)} onClick={runTabPFN}>{running ? "TabPFN API 분석 중…" : "TabPFN 모델 실행"}<b>→</b></button>
              {service === "offline" && <div className="engine-guide"><strong>TabPFN API 설정을 확인하세요</strong><code>Railway Variables → PRIORLABS_API_KEY</code><small>{serviceMessage || "API 키는 브라우저나 GitHub에 노출되지 않고 STATEtistic 서버에서만 사용됩니다."}</small></div>}
              {error && <div className="model-error">{error}</div>}
              {result && <ModelResults result={result} />}
              <p className="license-note">업로드한 데이터는 예측을 위해 Prior Labs API로 전송됩니다. 민감정보나 개인식별정보는 제거한 뒤 사용하세요.</p>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function CustomChart({ data, xColumn, yColumn, type }: { data: ParsedCsv; xColumn: string; yColumn: string; type: string }) {
  const rows = data.rows.slice(0, 120).filter(row => Number.isFinite(Number(row[yColumn])));
  if (!rows.length) return <div className="chart-no-data">선택한 Y축에 숫자 데이터가 없습니다.</div>;
  const values = rows.map(row => Number(row[yColumn]));
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const y = (value: number) => 230 - ((value - minY) / Math.max(1, maxY - minY)) * 185;

  if (type === "histogram") {
    const bins = Array.from({ length: 10 }, () => 0);
    values.forEach(value => bins[Math.min(9, Math.floor(((value - minY) / Math.max(1, maxY - minY)) * 10))]++);
    const maxBin = Math.max(...bins);
    return <svg className="custom-chart" viewBox="0 0 620 270" role="img" aria-label={`${yColumn} 히스토그램`}>{bins.map((count, i) => <g key={i}><rect x={38 + i * 56} y={230 - (count / maxBin) * 185} width="46" height={(count / maxBin) * 185} rx="4" fill="#3758d3" opacity={.45 + i * .045} /><text x={61 + i * 56} y="252" className="studio-axis">{(minY + (i / 10) * (maxY - minY)).toFixed(0)}</text></g>)}</svg>;
  }

  const categoricalX = !isNumericColumn(rows, xColumn);
  if (type === "bar") {
    const groups = new Map<string, number[]>();
    rows.forEach(row => groups.set(row[xColumn], [...(groups.get(row[xColumn]) ?? []), Number(row[yColumn])]));
    const entries = Array.from(groups).slice(0, 10).map(([label, group]) => ({ label, value: group.reduce((a, b) => a + b, 0) / group.length }));
    return <svg className="custom-chart" viewBox="0 0 620 270" role="img" aria-label={`${xColumn}별 ${yColumn} 평균`}>{entries.map((entry, i) => <g key={entry.label}><rect x={40 + i * 56} y={y(entry.value)} width="38" height={230 - y(entry.value)} rx="4" fill={i % 2 ? "#23a19b" : "#3758d3"} /><text x={59 + i * 56} y="252" className="studio-axis">{entry.label.slice(0, 6)}</text></g>)}</svg>;
  }

  const xValues = categoricalX ? rows.map((_, index) => index) : rows.map(row => Number(row[xColumn]));
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const x = (value: number) => 38 + ((value - minX) / Math.max(1, maxX - minX)) * 550;
  const points = rows.map((row, index) => ({ x: x(xValues[index]), y: y(Number(row[yColumn])), label: row[xColumn] }));
  return <svg className="custom-chart" viewBox="0 0 620 270" role="img" aria-label={`${xColumn}과 ${yColumn} ${type === "line" ? "선 그래프" : "산점도"}`}>
    {[0, 1, 2, 3, 4].map(i => <line key={i} x1="35" x2="600" y1={45 + i * 46} y2={45 + i * 46} className="studio-gridline" />)}
    {type === "line" && <polyline points={points.map(point => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#3758d3" strokeWidth="2.5" />}
    {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={type === "line" ? 3 : 4.5} fill={index % 3 ? "#3758d3" : "#23a19b"} opacity=".78"><title>{point.label}: {rows[index][yColumn]}</title></circle>)}
    <text x="35" y="32" className="studio-axis start">{maxY.toFixed(1)}</text><text x="35" y="252" className="studio-axis start">{minY.toFixed(1)}</text>
  </svg>;
}

function ModelResults({ result }: { result: ModelResult }) {
  return <div className="model-results">
    <div className="metric-row">{Object.entries(result.metrics).map(([label, value]) => <div key={label}><span>{label.replaceAll("_", " ")}</span><strong>{Number(value).toFixed(3)}</strong></div>)}</div>
    <div className="prediction-table"><div><b>실제값</b><b>예측값</b><b>신뢰도</b></div>{result.predictions.slice(0, 6).map((item, index) => <div key={index}><span>{String(item.actual)}</span><span>{String(item.predicted)}</span><span>{item.confidence == null ? "—" : `${(item.confidence * 100).toFixed(1)}%`}</span></div>)}</div>
    <small>{result.device} · {result.rows} rows · {result.features} features</small>
  </div>;
}
