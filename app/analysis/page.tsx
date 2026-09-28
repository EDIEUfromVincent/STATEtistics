"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { AppHeader } from "../components/AppHeader";
import { classStandards, distractors, itemStats, studentStandards } from "../lib/assessment/analysis";
import { loadAnswerKey } from "../lib/assessment/answerKey";
import { parseCsv, toCsv } from "../lib/assessment/csv";
import { LONG_COLUMNS, pendingCount, type LongRow } from "../lib/assessment/records";
import { SAMPLE_KEY_CSV } from "../lib/assessment/sampleKey";
import { STANDARDS } from "../lib/assessment/standards";
import { generateClass } from "../lib/assessment/synthetic";
import { downloadBlob } from "../lib/generator";

type Loaded = { name: string; rows: LongRow[] };

const noopSubscribe = () => () => {};
const pct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);

function toRows(text: string): LongRow[] {
  const { columns, rows } = parseCsv(text);
  const missing = LONG_COLUMNS.filter(c => !columns.includes(c));
  if (missing.length) throw new Error(`평가 응답 CSV가 아닙니다. 없는 열: ${missing.join(", ")}`);
  return rows as LongRow[];
}

export default function AnalysisPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [fileError, setFileError] = useState("");
  // 채점 화면에서 넘어온 결과 (이 탭의 sessionStorage에만 있다)
  const handoff = useSyncExternalStore(noopSubscribe, () => sessionStorage.getItem("statetistic:assessmentCsv"), () => null);
  const fromHandoff = useMemo(() => {
    if (!handoff) return { data: null, error: "" };
    try {
      return { data: { name: "채점 결과", rows: toRows(handoff) }, error: "" };
    } catch (e) {
      return { data: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [handoff]);
  const data = loaded ?? fromHandoff.data;
  const error = fileError || (loaded ? "" : fromHandoff.error);

  function setData(next: Loaded) {
    setLoaded(next);
    setFileError("");
  }

  async function handleFile(file?: File) {
    if (!file) return;
    try {
      setData({ name: file.name, rows: toRows(await file.text()) });
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  }

  function practice() {
    const items = loadAnswerKey(SAMPLE_KEY_CSV);
    const seed = Math.floor(Math.random() * 100000);
    setData({ name: `합성 반 (seed ${seed})`, rows: generateClass(items, { students: 25, seed, assessmentId: "합성-6과-연소", confirmEssays: true }).rows });
  }

  const analysis = useMemo(() => {
    if (!data) return null;
    const items = itemStats(data.rows);
    const per = studentStandards(data.rows);
    return { items, per, cls: classStandards(per), dist: distractors(data.rows), pending: pendingCount(data.rows) };
  }, [data]);

  function sendToStudio() {
    if (!data) return;
    sessionStorage.setItem("statetistic:handoffCsv", toCsv([...LONG_COLUMNS], data.rows));
    sessionStorage.setItem("statetistic:handoffName", `${data.name}.csv`);
    window.location.href = "/studio";
  }

  return (
    <main>
      <AppHeader active="analysis" title="평가 분석" description="성취기준을 기준으로 문항·오답·학생별 근거를 봅니다. 성취수준은 교사가 판정합니다." />
      <div className="grading-page">
        <section className="studio-intro">
          <div>
            <span className="studio-kicker">STATEtistic / ASSESSMENT</span>
            <h2>점수가 아니라<br /><em>성취기준의 근거로.</em></h2>
          </div>
          <div className="analysis-load">
            <label className="upload-drop">
              <input type="file" accept=".csv,text/csv" onChange={e => handleFile(e.target.files?.[0])} />
              <b>응답_long.csv 불러오기</b>
              <span>{data ? `${data.name} · ${new Set(data.rows.map(r => r.학생코드)).size}명 · ${data.rows.length}행` : "채점 화면에서 넘어오거나 파일을 선택하세요"}</span>
            </label>
            <button className="secondary-action" onClick={practice}>합성 반으로 연습하기</button>
          </div>
        </section>
        {error && <div className="model-error">{error}</div>}

        {analysis && data && <>
          <div className="kpi-grid">
            <div className="kpi"><span>응시 학생</span><strong>{new Set(data.rows.map(r => r.학생코드)).size}명</strong></div>
            <div className="kpi"><span>문항</span><strong>{analysis.items.length}개</strong><small>성취기준 {analysis.cls.length}개</small></div>
            <div className="kpi"><span>교사 확인 대기</span><strong>{analysis.pending}건</strong><small className={analysis.pending ? "negative" : ""}>{analysis.pending ? "확정 전 문항은 정답률을 비워 둡니다" : "모두 확정됨"}</small></div>
            <div className="kpi"><span>자동 채점 비율</span><strong>{pct(data.rows.filter(r => r.채점방식 === "자동").length / data.rows.length)}</strong><small>나머지는 교사 확정</small></div>
          </div>

          <h3 className="section-title">성취기준별 근거</h3>
          <div className="standard-grid">
            {analysis.cls.map(c => {
              const s = STANDARDS[c.성취기준];
              const weak = analysis.per.filter(r => r.성취기준 === c.성취기준 && r.득점률 != null && r.득점률 < 0.5);
              return <article className="standard-card" key={c.성취기준}>
                <header><b>{c.성취기준}</b><span>{s?.statement ?? "성취기준 원문이 아직 등록되지 않았습니다"}</span></header>
                <div className="rate-bar"><i style={{ width: pct(c.평균득점률) }} /><em>반 평균 득점률 {pct(c.평균득점률)}</em></div>
                <p>관련 문항 {c.문항수}개 · 행동영역 {c.행동영역 || "–"} · 절반 미만 {c.절반미만학생수}명{weak.length ? `: ${weak.map(w => w.학생코드).join(", ")}` : ""}</p>
                {s && <details><summary>성취수준 기술 (비교용)</summary><dl>{(["A", "B", "C"] as const).map(k => <div key={k}><dt>{k}</dt><dd>{s.levels[k]}</dd></div>)}</dl><small>{s.source}</small></details>}
                <p className="warn-note">이 평가의 문항만으로 성취수준을 판정하지 않습니다. 위 기술과 행동영역을 비교해 서술형·수행평가 근거가 더 필요한지 판단하세요.</p>
              </article>;
            })}
          </div>

          <h3 className="section-title">많이 고른 오답 (20% 이상)</h3>
          <p className="helper-line">같은 오답에 학생이 몰리면 공통된 오개념일 가능성이 큽니다.</p>
          <div className="table-scroll small-table"><table><thead><tr><th>문항</th><th>응답</th><th>학생수</th><th>비율</th></tr></thead><tbody>
            {analysis.dist.filter(d => !d.정답 && d.비율 >= 0.2).map(d => <tr key={`${d.문항}-${d.응답}`}><td>{d.문항}</td><td>{d.응답}</td><td>{d.학생수}</td><td>{pct(d.비율)}</td></tr>)}
          </tbody></table></div>

          <h3 className="section-title">문항 분석</h3>
          <div className="table-scroll small-table"><table><thead><tr><th>문항</th><th>유형</th><th>성취기준</th><th>행동영역</th><th>난이도</th><th>정답률</th><th>변별도</th><th>무응답</th><th>비고</th></tr></thead><tbody>
            {analysis.items.map(i => <tr key={i.문항}><td>{i.문항}</td><td>{i.유형}</td><td>{i.성취기준}</td><td>{i.행동영역}</td><td>{i.난이도}</td>
              <td><span className="mini-bar"><i style={{ width: pct(i.정답률) }} /></span>{pct(i.정답률)}</td>
              <td className={i.변별도 != null && i.변별도 <= 0 ? "bad-cell" : ""}>{i.변별도 ?? "–"}</td><td>{i.무응답}</td><td>{i.비고}</td></tr>)}
          </tbody></table></div>
          <p className="helper-line">변별도 = 상위 27% 정답률 − 하위 27% 정답률. 0 이하인 문항(빨간 칸)은 문항 자체를 점검해 보세요.</p>

          <h3 className="section-title">학생 × 성취기준 득점률</h3>
          <StudentMatrix per={analysis.per} standards={analysis.cls.map(c => c.성취기준)} />

          <div className="grading-actions">
            <button className="primary-action" onClick={sendToStudio}>시각화 · TabPFN으로 보내기</button>
            <button className="secondary-action" onClick={() => downloadBlob(`﻿${toCsv(Object.keys(analysis.items[0] ?? {}), analysis.items)}`, "문항분석.csv", "text/csv")}>문항분석.csv</button>
            <button className="secondary-action" onClick={() => downloadBlob(`﻿${toCsv(Object.keys(analysis.per[0] ?? {}), analysis.per)}`, "학생별_성취기준.csv", "text/csv")}>학생별_성취기준.csv</button>
          </div>
        </>}
      </div>
    </main>
  );
}

function StudentMatrix({ per, standards }: { per: ReturnType<typeof studentStandards>; standards: string[] }) {
  const codes = [...new Set(per.map(p => p.학생코드))].sort();
  const cell = new Map(per.map(p => [`${p.학생코드}|${p.성취기준}`, p]));
  return <div className="table-scroll small-table"><table className="matrix"><thead><tr><th>학생</th>{standards.map(s => <th key={s}>{s}</th>)}</tr></thead><tbody>
    {codes.map(code => <tr key={code}><td><b>{code}</b></td>{standards.map(s => {
      const p = cell.get(`${code}|${s}`);
      const v = p?.득점률;
      return <td key={s} title={p?.틀린문항 ? `틀린 문항: ${p.틀린문항}` : ""} style={{ background: v == null ? "#f4f5f8" : `rgba(55,88,211,${0.1 + v * 0.75})`, color: v != null && v > 0.55 ? "white" : undefined }}>{pct(v)}</td>;
    })}</tr>)}
  </tbody></table></div>;
}
