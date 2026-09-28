"use client";

import Link from "next/link";
import { TEMPLATES } from "../../lib/assessment/images";
import { SAMPLE_KEY_CSV, SAMPLE_KEY_NAME } from "../../lib/assessment/sampleKey";
import { downloadBlob } from "../../lib/generator";
import { useGrading } from "../GradingContext";

export default function KeyStep() {
  const g = useGrading();
  const unmapped = g.items.filter(i => i.mappingStatus && i.mappingStatus !== "확인").map(i => i.no);

  return (
    <section className="grading-card">
      <header><span>2</span><h3>정답표와 평가 설정</h3><p>정답표(이원분류표) CSV를 불러옵니다. 출판사 정답표는 이 브라우저에서만 읽고 서버에 올리지 않습니다.</p></header>
      {g.roster.length === 0 && <p className="warn-note">명부가 아직 없습니다. <Link href="/grading">1단계 명부</Link>를 먼저 만들어도 되고, 정답표를 먼저 불러와도 됩니다.</p>}
      <div className="grading-actions">
        <label className="primary-action file-button">정답표 CSV 불러오기<input type="file" accept=".csv" onChange={async e => { const f = e.target.files?.[0]; if (f) g.applyKey(await f.text(), f.name); }} /></label>
        <button className="secondary-action" onClick={() => g.applyKey(SAMPLE_KEY_CSV, SAMPLE_KEY_NAME)}>예시 정답표 쓰기</button>
        <button className="secondary-action" onClick={() => downloadBlob(`﻿${SAMPLE_KEY_CSV}`, SAMPLE_KEY_NAME, "text/csv")}>양식 내려받기</button>
      </div>
      {g.keyError && <pre className="model-error">{g.keyError}</pre>}
      {g.items.length > 0 && <>
        <div className="grading-row">
          <label>평가ID<input value={g.assessmentId} onChange={e => g.setAssessmentId(e.target.value)} /></label>
          <label>출처<input value={g.source} onChange={e => g.setSource(e.target.value)} placeholder="예: 아이스크림" /></label>
          <label>이름 칸 양식<select value={g.templateId} onChange={e => g.setTemplateId(e.target.value)}>{TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>학생 1명 쪽수<input type="number" min={1} max={10} value={g.pagesPerStudent} onChange={e => g.setPagesPerStudent(Number(e.target.value))} /></label>
        </div>
        <p className="helper-line">{g.keyName} · 문항 {g.items.length}개 · 성취기준 {[...new Set(g.items.map(i => i.standard))].join(", ")}</p>
        <div className="table-scroll small-table"><table><thead><tr><th>문항</th><th>쪽</th><th>유형</th><th>배점</th><th>성취기준</th><th>행동영역</th><th>난이도</th><th>매핑</th></tr></thead><tbody>
          {g.items.map(i => <tr key={i.no}><td>{i.no}</td><td>{i.pages.join(",")}</td><td>{i.kind}</td><td>{i.points}</td><td>{i.standard}</td><td>{i.domain}</td><td>{i.difficulty}</td><td className={i.mappingStatus && i.mappingStatus !== "확인" ? "bad-cell" : ""}>{i.mappingStatus}</td></tr>)}
        </tbody></table></div>
        {unmapped.length > 0 && <p className="warn-note">성취기준 매핑이 확인되지 않은 문항: {unmapped.join(", ")} — 정답표의 매핑상태 열을 &quot;확인&quot;으로 바꾸면 이 표시가 사라집니다.</p>}
        <div className="step-next">{g.roster.length > 0 ? <Link className="primary-action" href="/grading/photos">다음: 사진 넣기 →</Link> : <Link className="primary-action" href="/grading">명부 만들러 가기 →</Link>}</div>
      </>}
    </section>
  );
}
