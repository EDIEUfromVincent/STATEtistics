"use client";

import Link from "next/link";
import { ITEM_KINDS } from "../../lib/assessment/answerKey";
import { SAMPLE_KEY_CSV, SAMPLE_KEY_NAME } from "../../lib/assessment/sampleKey";
import { STANDARDS } from "../../lib/assessment/standards";
import { downloadBlob } from "../../lib/generator";
import { DropZone } from "../DropZone";
import { useGrading } from "../GradingContext";

export default function KeyStep() {
  const g = useGrading();
  const d = g.draft;
  const unmapped = g.items.filter(i => i.mappingStatus && i.mappingStatus !== "확인").map(i => i.no);
  const prefix = d?.rows.find(r => r.성취기준)?.성취기준.slice(0, 3) ?? "";
  const codes = [...new Set([...(d?.rows.map(r => r.성취기준).filter(Boolean) ?? []), ...Object.keys(STANDARDS).filter(c => prefix && c.startsWith(prefix))])].sort();
  const doubtful = d ? d.rows.filter(r => r.확신 !== "확인" || (r.유형 !== "서술" && !r.정답)).length : 0;

  return (
    <section className="grading-card">
      <header><span>2</span><h3>시험지 넣기</h3><p>학생에게 나눠 준 것과 같은 <b>빈 시험지 PDF</b>(정답·해설 쪽 포함)를 넣으세요. 앱이 답 칸 위치를 찾고, 정답·해설 쪽을 읽어 정답표 초안을 만듭니다. 표를 확인하고 &quot;확정&quot;을 누르면 채점 준비가 끝납니다. 시험지 PDF는 이 브라우저에서만 쓰고 저장하지 않으며, 초안을 만들 때 문제·해설의 글자만 판독 서버로 보냅니다.</p></header>

      {/* 항상 보인다: 비어 있을 때만 보이게 했더니 첫 글자를 치자마자 칸이 사라졌다 */}
      <div className="grading-row">
        <label className="access-key-control">접속 코드<input type="password" autoComplete="off" value={g.accessKey} onChange={e => g.updateAccessKey(e.target.value)} placeholder="Railway의 STATETISTIC_ACCESS_KEY 값" /></label>
        <p className="helper-line">정답표 초안을 만들 때 필요합니다. 이 탭을 닫으면 지워집니다.</p>
      </div>

      <DropZone accept=".pdf,application/pdf" disabled={!!g.draftBusy} onFiles={files => g.learnFromPdf(files[0])}
        title={g.draftBusy || (g.blankPdf && !d ? `넣은 시험지: ${g.blankPdf.name} — 다른 시험지로 바꾸려면 다시 넣으세요` : "빈 시험지 PDF를 여기에 끌어다 놓거나 눌러서 고르세요")}>
        한글·워드에서 만든 PDF · 정답·해설 쪽이 있으면 정답까지 채워 줍니다 · 종이를 스캔한 PDF는 칸을 찾지 못합니다
      </DropZone>
      {g.draftError && <div className="model-error">{g.draftError}</div>}

      {d && <>
        <h4>정답표 초안 — {d.fileName} · 답 칸 {d.rows.length}개{d.usd ? ` · 약 ${Math.max(1, Math.round(d.usd * g.pricing.usdKrw))}원` : ""}</h4>
        <p className={doubtful ? "warn-note" : "helper-line"}>{doubtful ? `노란 줄 ${doubtful}개는 AI가 확실하지 않다고 한 칸이거나 정답이 비어 있습니다. 시험지와 대조해 고쳐 주세요.` : "AI가 해설에서 모든 정답을 찾았습니다. 그래도 한 번 훑어보고 확정하세요."} 정답에서 &quot;=&quot;로 이은 표기는 모두 정답으로 인정합니다.</p>
        <div className="table-scroll small-table"><table><thead><tr><th>칸</th><th>유형</th><th>정답 (= 로 함께 인정)</th><th>배점</th><th>성취기준</th><th>시험지 위치 · 근거</th></tr></thead><tbody>
          {d.rows.map((r, i) => {
            const set = (patch: Partial<typeof r>) => g.setDraftRows(rows => rows.map((x, k) => (k === i ? { ...x, ...patch, 확신: patch.확신 ?? "확인" } : x)));
            const warn = r.확신 !== "확인" || (r.유형 !== "서술" && !r.정답);
            return <tr key={r.문항} className={warn ? "warn-row" : ""}>
              <td><b>{r.문항}</b></td>
              <td><select value={r.유형} onChange={e => set({ 유형: e.target.value })}>{ITEM_KINDS.map(k => <option key={k}>{k}</option>)}</select></td>
              <td>{r.유형 === "서술"
                ? <textarea className="essay-text" rows={2} value={r.채점기준 ?? ""} placeholder="채점 기준" onChange={e => set({ 채점기준: e.target.value })} />
                : <input className="cell-input wide" value={r.정답} placeholder="정답" onChange={e => set({ 정답: e.target.value })} />}</td>
              <td><input className="cell-input" type="number" min={0.5} step={0.5} value={r.배점} onChange={e => set({ 배점: Number(e.target.value) })} /></td>
              <td><select value={r.성취기준} onChange={e => set({ 성취기준: e.target.value })}><option value="">선택</option>{codes.map(c => <option key={c}>{c}</option>)}</select></td>
              <td><small>{r.판독안내}</small>{r.근거 && <small className="reading-pair">근거: {r.근거}</small>}</td>
            </tr>;
          })}
        </tbody></table></div>
        <div className="grading-actions">
          <button className="primary-action" onClick={g.adoptDraft}>이 정답표로 확정</button>
          <button className="secondary-action" onClick={g.discardDraft}>초안 버리기</button>
        </div>
      </>}

      {g.items.length > 0 && !d && <>
        <p className="ok-note">채점 준비 완료 · {g.keyName} · 문항 {g.items.length}개 · 배점 합계 {g.items.reduce((s, i) => s + i.points, 0)}점{g.useCells ? " · 답 칸 위치 연결됨" : ""}</p>
        <div className="grading-row">
          <label>평가 이름<input value={g.assessmentId} onChange={e => g.setAssessmentId(e.target.value)} /></label>
          <label>출처<input value={g.source} onChange={e => g.setSource(e.target.value)} placeholder="예: 아이스크림" /></label>
        </div>
        <details>
          <summary className="helper-line">확정한 정답표 보기</summary>
          <div className="table-scroll small-table"><table><thead><tr><th>문항</th><th>유형</th><th>정답</th><th>배점</th><th>성취기준</th></tr></thead><tbody>
            {g.items.map(i => <tr key={i.no}><td>{i.no}</td><td>{i.kind}</td><td className="essay-cell">{i.kind === "서술" ? <small>{i.rubric}</small> : i.answer}</td><td>{i.points}</td><td>{i.standard}</td></tr>)}
          </tbody></table></div>
        </details>
        {unmapped.length > 0 && <p className="warn-note">성취기준 확인이 필요한 문항: {unmapped.join(", ")}</p>}
        <div className="step-next">{g.roster.length > 0 ? <Link className="primary-action" href="/grading/photos">다음: 학생 답안 넣기 →</Link> : <Link className="primary-action" href="/grading">학생 번호 만들러 가기 →</Link>}</div>
      </>}

      <details className="advanced">
        <summary>이미 만든 정답표 파일이 있으면</summary>
        <div className="grading-actions">
          <label className="secondary-action file-button">정답표 CSV<input type="file" accept=".csv" onChange={async e => { const f = e.target.files?.[0]; if (f) g.applyKey(await f.text(), f.name); e.target.value = ""; }} /></label>
          <label className="secondary-action file-button">칸 양식 JSON{g.formName ? ` · ${g.formName}` : ""}<input type="file" accept=".json,application/json" onChange={async e => { const f = e.target.files?.[0]; if (f) g.applyForm(await f.text(), f.name); e.target.value = ""; }} /></label>
          <label className="secondary-action file-button">빈 시험지 PDF만{g.blankPdf ? ` · ${g.blankPdf.name}` : ""}<input type="file" accept=".pdf,application/pdf" onChange={e => { g.setBlank(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>
          <button className="secondary-action" onClick={() => g.applyKey(SAMPLE_KEY_CSV, SAMPLE_KEY_NAME)}>예시 정답표</button>
          <button className="secondary-action" onClick={() => downloadBlob(`﻿${SAMPLE_KEY_CSV}`, SAMPLE_KEY_NAME, "text/csv")}>정답표 양식 내려받기</button>
        </div>
        {g.keyError && <pre className="model-error">{g.keyError}</pre>}
        {g.formError && <pre className="model-error">{g.formError}</pre>}
      </details>
    </section>
  );
}
