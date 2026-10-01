"use client";

import Link from "next/link";
import { SAMPLE_KEY_CSV, SAMPLE_KEY_NAME } from "../../lib/assessment/sampleKey";
import { downloadBlob } from "../../lib/generator";
import { useGrading } from "../GradingContext";

export default function KeyStep() {
  const g = useGrading();
  const unmapped = g.items.filter(i => i.mappingStatus && i.mappingStatus !== "확인").map(i => i.no);

  return (
    <section className="grading-card">
      <header><span>2</span><h3>정답표와 평가 정보</h3><p>정답표(이원분류표) CSV를 불러옵니다. 출판사 정답표는 이 브라우저에서만 읽고 서버에 올리지 않습니다. 판독에는 정답을 보내지 않습니다.</p></header>
      <div className="grading-actions">
        <label className="primary-action file-button">정답표 CSV 불러오기<input type="file" accept=".csv" onChange={async e => { const f = e.target.files?.[0]; if (f) g.applyKey(await f.text(), f.name); e.target.value = ""; }} /></label>
        <button className="secondary-action" onClick={() => g.applyKey(SAMPLE_KEY_CSV, SAMPLE_KEY_NAME)}>예시 정답표 쓰기</button>
        <button className="secondary-action" onClick={() => downloadBlob(`﻿${SAMPLE_KEY_CSV}`, SAMPLE_KEY_NAME, "text/csv")}>양식 내려받기</button>
      </div>
      <p className="helper-line">필수 열: 문항 · 유형(선택형/복수선택/기호/OX/단답/서술) · 정답 · 배점 · 성취기준. 페이지 열은 없어도 됩니다.</p>
      {g.keyError && <pre className="model-error">{g.keyError}</pre>}
      {g.items.length > 0 && <>
        <div className="grading-row">
          <label>평가ID<input value={g.assessmentId} onChange={e => g.setAssessmentId(e.target.value)} /></label>
          <label>출처<input value={g.source} onChange={e => g.setSource(e.target.value)} placeholder="예: 아이스크림" /></label>
        </div>
        <p className="helper-line">{g.keyName} · 문항 {g.items.length}개 · 배점 합계 {g.items.reduce((s, i) => s + i.points, 0)}점 · 성취기준 {[...new Set(g.items.map(i => i.standard))].join(", ")}</p>
        <div className="table-scroll small-table"><table><thead><tr><th>문항</th><th>유형</th><th>정답</th><th>배점</th><th>성취기준</th><th>행동영역</th><th>난이도</th><th>매핑</th></tr></thead><tbody>
          {g.items.map(i => <tr key={i.no}><td>{i.no}</td><td>{i.kind}</td><td className="essay-cell">{i.kind === "서술" ? <small>{i.rubric}</small> : i.answer}</td><td>{i.points}</td><td>{i.standard}</td><td>{i.domain}</td><td>{i.difficulty}</td><td className={i.mappingStatus && i.mappingStatus !== "확인" ? "bad-cell" : ""}>{i.mappingStatus}</td></tr>)}
        </tbody></table></div>
        <div className="rubric-box">
          <b>양식 기반 판독 (권장)</b>
          <p>양식 파일(칸 위치 JSON)과 빈 시험지 PDF를 함께 넣으면 쪽 전체 대신 <b>답 칸 조각만</b> 판독기로 보냅니다. 빈칸과 고르는 칸은 AI 없이 잉크로 판정하고, 손글씨 칸은 서로 다른 두 모델이 같게 읽을 때만 자동 확정합니다. 빈 시험지는 이 브라우저에서만 씁니다.</p>
          <div className="grading-actions">
            <label className="secondary-action file-button">양식 파일(JSON){g.formName ? ` · ${g.formName}` : ""}<input type="file" accept=".json,application/json" onChange={async e => { const f = e.target.files?.[0]; if (f) g.applyForm(await f.text(), f.name); e.target.value = ""; }} /></label>
            <label className="secondary-action file-button">빈 시험지 PDF{g.blankPdf ? ` · ${g.blankPdf.name}` : ""}<input type="file" accept=".pdf,application/pdf" onChange={e => { g.setBlank(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>
          </div>
          {g.formError && <pre className="model-error">{g.formError}</pre>}
          {g.form && <p className="helper-line">{g.form.form} · {g.form.pages}쪽 · 칸 {Object.keys(g.form.cells).length}개 {g.useCells ? "→ 양식 기반 판독을 씁니다" : "→ 빈 시험지 PDF도 넣어 주세요"}</p>}
        </div>
        {unmapped.length > 0 && <p className="warn-note">성취기준 매핑이 확인되지 않은 문항: {unmapped.join(", ")} — 정답표의 매핑상태 열을 &quot;확인&quot;으로 바꾸면 이 표시가 사라집니다.</p>}
        <div className="step-next">{g.roster.length > 0 ? <Link className="primary-action" href="/grading/photos">다음: 사진 넣기 →</Link> : <Link className="primary-action" href="/grading">학생 번호 만들러 가기 →</Link>}</div>
      </>}
    </section>
  );
}
