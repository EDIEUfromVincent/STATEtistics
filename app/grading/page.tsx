"use client";

import Link from "next/link";
import { rosterToCsv } from "../lib/assessment/privacy";
import { downloadBlob } from "../lib/generator";
import { useGrading } from "./GradingContext";

export default function RosterStep() {
  const g = useGrading();

  function printCards() {
    const w = window.open("", "_blank");
    if (!w) return;
    const doc = w.document;
    doc.title = "학생 코드 카드";
    const style = doc.createElement("style");
    style.textContent = "body{font-family:sans-serif}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.c{border:1px dashed #999;padding:14px;text-align:center}b{display:block;font-size:40px;letter-spacing:6px;margin:6px 0}small{font-size:11px;color:#555}";
    doc.head.append(style);
    const grid = doc.createElement("div");
    grid.className = "g";
    for (const s of g.roster) {
      const card = doc.createElement("div");
      card.className = "c";
      const name = doc.createElement("div");
      name.textContent = s.name;
      const code = doc.createElement("b");
      code.textContent = s.code;
      const hint = doc.createElement("small");
      hint.textContent = "시험지 이름 칸에 이름 대신 이 코드를 쓰세요";
      card.append(name, code, hint);
      grid.append(card);
    }
    doc.body.append(grid);
    w.print();
  }

  return (
    <>
      <section className="grading-privacy">
        <div>
          <b>이 흐름의 보안 원칙</b>
          <p>이름이 적힌 원본 사진과 명부는 이 브라우저 안에만 있습니다. 서버로 가는 것은 이름 칸을 검게 가린 페이지와(판독용), 이름을 가린 서술형 답(선택)뿐이며, 서버는 저장하지 않습니다. 판독에는 정답을 보내지 않습니다. 페이지를 새로고침하면 처음부터 다시 시작합니다.</p>
        </div>
      </section>
      <section className="grading-card">
        <header><span>1</span><h3>학생 코드 명부</h3><p>코드는 출석번호와 무관한 무작위 값입니다. 명부는 서버로 보내지 않으며, 페이지를 닫으면 사라지니 파일로 보관하세요.</p></header>
        <div className="grading-two">
          <div>
            <textarea value={g.namesText} onChange={e => g.setNamesText(e.target.value)} rows={10} placeholder={"번호 순서대로 한 줄에 한 명씩\n김민준\n이서윤"} />
            <div className="grading-actions">
              <button className="primary-action" onClick={g.makeRoster}>코드 만들기</button>
              <label className="secondary-action file-button">명부 파일 불러오기<input type="file" accept=".csv" onChange={e => g.loadRosterFile(e.target.files?.[0])} /></label>
            </div>
            {g.rosterError && <div className="model-error">{g.rosterError}</div>}
          </div>
          <div>
            {g.roster.length > 0 && <>
              <div className="table-scroll small-table"><table><thead><tr><th>번호</th><th>이름</th><th>코드</th><th>결시</th></tr></thead>
                <tbody>{g.roster.map(s => <tr key={s.code}><td>{s.number}</td><td>{s.name}</td><td><b>{s.code}</b></td><td><input type="checkbox" checked={s.absent} onChange={() => g.toggleAbsent(s.code)} /></td></tr>)}</tbody></table></div>
              <div className="grading-actions">
                <button className="secondary-action" onClick={() => downloadBlob(`﻿${rosterToCsv(g.roster)}`, "명부_비공개.csv", "text/csv")}>명부 파일 저장</button>
                <button className="secondary-action" onClick={printCards}>코드 카드 인쇄</button>
              </div>
            </>}
          </div>
        </div>
        {g.roster.length > 0 && <div className="step-next"><Link className="primary-action" href="/grading/key">다음: 정답표 →</Link></div>}
      </section>
    </>
  );
}
