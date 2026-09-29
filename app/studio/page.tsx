"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "../components/AppHeader";
import { parseDataset, useCurrentDatasetRaw } from "../lib/dataset";

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
type Selection = { for: string | null; x: string; y: string; chart: string; target: string; features: string[] };

const ACCESS_KEY = "statetistic:accessKey";

function isNumericColumn(rows: Row[], column: string) {
  const present = rows.map(row => row[column]).filter(value => value !== "");
  return present.length > 0 && present.filter(value => Number.isFinite(Number(value))).length / present.length > 0.9;
}

// 예측에 쓸모가 없고 사람을 가리킬 수 있는 열은 기본으로 전송하지 않는다.
const IDENTIFIER_NAME = /(ID|Id|id|코드|이름|성명|학생명|번호)$/;
const FREE_TEXT_NAME = /(응답|메모|의견|서술|내용|코멘트|피드백)$/;

function excludedReason(rows: Row[], column: string) {
  const values = rows.map(row => row[column]).filter(Boolean);
  if (IDENTIFIER_NAME.test(column)) return "식별자";
  if (FREE_TEXT_NAME.test(column)) return "자유 서술";
  if (values.length > 10 && !isNumericColumn(rows, column) && new Set(values).size / values.length > 0.9) return "행마다 값이 다름";
  if (values.length && values.reduce((sum, v) => sum + v.length, 0) / values.length > 20) return "긴 글";
  return "";
}

function defaultFeatures(parsed: ParsedCsv, target: string) {
  return parsed.columns.filter(column => column !== target && !excludedReason(parsed.rows, column));
}

function defaultSelection(data: ParsedCsv | null, raw: string | null): Selection {
  if (!data) return { for: raw, x: "", y: "", chart: "scatter", target: "", features: [] };
  const numeric = data.columns.filter(column => isNumericColumn(data.rows, column));
  // 평가 응답이면 "정오"를 예측하는 것이 자연스럽다. 그 밖에는 마지막 열
  const target = data.columns.includes("정오") ? "정오" : data.columns[data.columns.length - 1] ?? "";
  // 평가 응답이면 문항별 평균 점수 막대가 첫 화면으로 알맞다
  if (["문항", "점수", "정오"].every(c => data.columns.includes(c))) {
    return { for: raw, x: "문항", y: "점수", chart: "bar", target, features: defaultFeatures(data, target) };
  }
  return { for: raw, x: data.columns[0] ?? "", y: numeric[0] ?? data.columns[1] ?? "", chart: "scatter", target, features: defaultFeatures(data, target) };
}

export default function StudioPage() {
  // 분석은 데이터를 들여오지 않는다. ① 데이터 준비에서 등록한 현재 데이터만 읽는다.
  const raw = useCurrentDatasetRaw();
  const dataset = useMemo(() => parseDataset(raw), [raw]);
  const data = useMemo<ParsedCsv | null>(() => (dataset ? { name: dataset.name, columns: dataset.columns, rows: dataset.rows } : null), [dataset]);
  const [task, setTask] = useState("classification");
  const [service, setService] = useState<"checking" | "online" | "offline">("checking");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ModelResult | null>(null);
  const [error, setError] = useState("");
  const [serviceMessage, setServiceMessage] = useState("");
  const [requiresAccessKey, setRequiresAccessKey] = useState(false);
  // 접속 코드는 탭을 닫으면 사라지게 둔다 (공용 PC에 남지 않게)
  const [accessKey, setAccessKey] = useState(() => (typeof window === "undefined" ? "" : sessionStorage.getItem(ACCESS_KEY) ?? ""));
  const [saved, setSaved] = useState<Selection | null>(null);

  useEffect(() => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem("statetistic:lastCsv"); // 예전 버전이 브라우저에 남긴 데이터를 지운다
    localStorage.removeItem("statetistic:lastName");
    checkService();
  }, []);

  // 현재 데이터가 바뀌면 열 선택을 그 데이터에 맞는 기본값으로 다시 잡는다
  const selection = saved && saved.for === raw ? saved : defaultSelection(data, raw);
  const { x: xColumn, y: yColumn, chart: chartType, target, features } = selection;
  const update = (patch: Partial<Selection>) => setSaved({ ...selection, ...patch, for: raw });
  const setChartType = (chart: string) => update({ chart });
  const setXColumn = (x: string) => update({ x });
  const setYColumn = (y: string) => update({ y });
  const setTarget = (value: string) => update({ target: value, features: data ? defaultFeatures(data, value) : [] });
  const setFeatures = (f: (current: string[]) => string[]) => update({ features: f(features) });

  const numericColumns = useMemo(() => data?.columns.filter(column => isNumericColumn(data.rows, column)) ?? [], [data]);

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
    sessionStorage.setItem(ACCESS_KEY, value);
  }

  async function runTabPFN() {
    if (!data || !target) return;
    if (dataset?.real && !confirm(`실제 학생 자료입니다. 체크한 열 ${features.length}개와 목표 열(${target})이 Prior Labs(외부)로 전송됩니다. 계속할까요?`)) return;
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
        // 고른 입력 열과 목표 열만 보낸다
        body: JSON.stringify({ rows: data.rows.map(row => Object.fromEntries([...features, target].map(column => [column, row[column]]))), target, task, test_size: 0.25 }),
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
      <AppHeader active="studio" title="시각화 · 예측" description="현재 데이터로 차트를 그리고 TabPFN 예측을 실행합니다. 예측만 외부(Prior Labs)로 전송됩니다." />
      <div className="studio-page">
        {!data ? (
          <section className="studio-empty"><span>DATA</span><h3>분석할 데이터가 없습니다</h3><p>① 데이터 준비에서 데이터를 만들거나 불러오면 여기서 바로 쓸 수 있습니다.</p><div className="empty-links"><Link href="/">합성 데이터 생성</Link><Link href="/grading">시험지 채점</Link><Link href="/import">CSV 가져오기</Link></div></section>
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
              <div className="chart-caption"><span>{xColumn}</span><i>×</i><span>{yColumn}</span><small>{chartType === "bar" || chartType === "histogram" ? `전체 ${data.rows.length.toLocaleString()}행으로 계산` : "점은 최대 120개 표시"}</small></div>
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
              <div className="feature-picker" aria-label="전송할 입력 열">
                {data.columns.filter(column => column !== target).map(column => {
                  const reason = excludedReason(data.rows, column);
                  return <label key={column} title={reason ? `기본 제외: ${reason}` : ""}><input type="checkbox" checked={features.includes(column)} onChange={event => setFeatures(current => event.target.checked ? [...current, column] : current.filter(v => v !== column))} />{column}{reason && <small> ({reason})</small>}</label>;
                })}
              </div>
              {requiresAccessKey && <label className="access-key-control">분석 액세스 코드<input type="password" autoComplete="off" value={accessKey} onChange={event => updateAccessKey(event.target.value)} placeholder="이 탭을 닫으면 지워집니다" /></label>}
              <div className="model-spec">
                <div><span>TRAIN</span><b>75%</b></div><div><span>TEST</span><b>25%</b></div><div><span>FEATURES</span><b>{features.length}</b></div><div><span>ROWS</span><b>{data.rows.length}</b></div>
              </div>
              <button className="run-model" disabled={running || service === "offline" || (requiresAccessKey && !accessKey) || !features.length} onClick={runTabPFN}>{running ? "TabPFN API 분석 중…" : "TabPFN 모델 실행"}<b>→</b></button>
              {service === "offline" && <div className="engine-guide"><strong>TabPFN API 설정을 확인하세요</strong><code>Railway Variables → PRIORLABS_API_KEY</code><small>{serviceMessage || "API 키는 브라우저나 GitHub에 노출되지 않고 STATEtistic 서버에서만 사용됩니다."}</small></div>}
              {error && <div className="model-error">{error}</div>}
              {result && <ModelResults result={result} />}
              <p className={dataset?.real ? "warn-note" : "license-note"}>{dataset?.real ? "실제 학생 자료입니다. " : ""}체크한 열 {features.length}개와 목표 열만 예측을 위해 Prior Labs API(외부)로 전송됩니다. 식별자·자유 서술 열은 기본으로 빠져 있습니다.</p>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function CustomChart({ data, xColumn, yColumn, type }: { data: ParsedCsv; xColumn: string; yColumn: string; type: string }) {
  // 평균·분포는 전체 행으로 계산한다. 점을 찍는 차트만 화면이 넘치지 않게 120개로 줄인다
  const limit = type === "bar" || type === "histogram" ? data.rows.length : 120;
  const rows = data.rows.slice(0, limit).filter(row => row[yColumn] !== "" && Number.isFinite(Number(row[yColumn])));
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
    const entries = Array.from(groups)
      .sort((a, b) => (Number(a[0]) - Number(b[0])) || a[0].localeCompare(b[0]))
      .slice(0, 24)
      .map(([label, group]) => ({ label, value: group.reduce((a, b) => a + b, 0) / group.length }));
    const step = 560 / Math.max(1, entries.length);
    return <svg className="custom-chart" viewBox="0 0 620 270" role="img" aria-label={`${xColumn}별 ${yColumn} 평균`}>{entries.map((entry, i) => <g key={entry.label}><rect x={40 + i * step} y={y(entry.value)} width={step * 0.68} height={230 - y(entry.value)} rx="4" fill={i % 2 ? "#23a19b" : "#3758d3"}><title>{entry.label}: {entry.value.toFixed(2)}</title></rect><text x={40 + i * step + step * 0.34} y="252" className="studio-axis">{entry.label.slice(0, 6)}</text></g>)}</svg>;
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
