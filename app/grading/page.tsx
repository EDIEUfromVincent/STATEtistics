"use client";

import Link from "next/link";
import { rosterToCsv, studentLabel } from "../lib/assessment/privacy";
import { downloadBlob } from "../lib/generator";
import { useGrading } from "./GradingContext";

export default function RosterStep() {
  const g = useGrading();

  return (
    <>
      <section className="grading-privacy">
        <div>
          <b>이 흐름의 보안 원칙</b>
          <p>학생 이름은 받지 않습니다. 학생은 &quot;13번 · K3M&quot;처럼 번호와 무작위 가명 코드로만 표시합니다. 시험지의 이름 칸은 이 브라우저에서 검게 가리고, 이름 칸 사진은 만들지도 보여 주지도 않습니다. 서버로 가는 것은 답 칸 조각(양식 기반 판독)이나 이름 칸을 가린 쪽뿐이고, 서버는 저장하지 않습니다. 페이지를 새로고침하면 처음부터 다시 시작합니다.</p>
        </div>
      </section>
      <section className="grading-card">
        <header><span>1</span><h3>학생 번호</h3><p>이 반의 학생 수와 결시한 번호만 적으세요. 스캔은 번호 순서대로 넣으면 됩니다. 가명 코드는 번호와 무관한 무작위 값입니다.</p></header>
        <div className="grading-two">
          <div>
            <div className="grading-row">
              <label>반<input value={g.className} onChange={e => g.setClassName(e.target.value)} placeholder="예: 6-4" /></label>
              <label>학생 수<input type="number" min={1} max={60} value={g.studentCount} onChange={e => g.setStudentCount(e.target.value)} placeholder="예: 24" /></label>
              <label>결시 번호<input value={g.absentText} onChange={e => g.setAbsentText(e.target.value)} placeholder="예: 3, 17 (없으면 비움)" /></label>
            </div>
            <div className="grading-actions">
              <button className="primary-action" onClick={g.makeRoster}>학생 번호 만들기</button>
              <label className="secondary-action file-button">저장한 번호·코드 불러오기<input type="file" accept=".csv" onChange={e => g.loadRosterFile(e.target.files?.[0])} /></label>
            </div>
            {g.rosterError && <div className="model-error">{g.rosterError}</div>}
            <details className="helper-line">
              <summary>선택: 답에 쓴 학생 이름 가리기</summary>
              <p>학생이 답에 자기나 친구 이름을 쓰는 경우를 가리려면 이름을 한 줄에 하나씩 적으세요. 이 목록은 판독 결과에서 이름을 [이름]으로 바꿀 때만 쓰고, 화면·결과·서버에는 나가지 않습니다.</p>
              <textarea value={g.namesText} onChange={e => g.setNamesText(e.target.value)} rows={4} placeholder={"이름 (선택)"} />
            </details>
          </div>
          <div>
            {g.roster.length > 0 && <>
              <div className="table-scroll small-table"><table><thead><tr><th>학생</th><th>결시</th></tr></thead>
                <tbody>{g.roster.map(s => <tr key={s.code}><td><b>{studentLabel(s)}</b></td><td><input type="checkbox" checked={s.absent} onChange={() => g.toggleAbsent(s.code)} /></td></tr>)}</tbody></table></div>
              <p className="helper-line">{g.className ? `${g.className}반 · ` : ""}응시 {g.students.length}명 · 결시 {g.roster.length - g.students.length}명</p>
              <div className="grading-actions">
                <button className="secondary-action" onClick={() => downloadBlob(`﻿${rosterToCsv(g.roster)}`, `${g.className || "반"}_번호_코드.csv`, "text/csv")}>번호·코드 저장 (다음에 같은 코드로 이어 쓰기)</button>
              </div>
            </>}
          </div>
        </div>
        {g.roster.length > 0 && <div className="step-next"><Link className="primary-action" href="/grading/key">다음: 정답표 →</Link></div>}
      </section>
    </>
  );
}
