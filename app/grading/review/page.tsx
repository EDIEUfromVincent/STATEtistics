"use client";

import Link from "next/link";
import { reviewKey } from "../../lib/assessment/records";
import { useGrading } from "../GradingContext";

export default function ReviewStep() {
  const g = useGrading();
  const r = g.result;
  if (!r) {
    return <section className="grading-card"><header><span>5</span><h3>교사 확인</h3></header><p className="warn-note">아직 판독 결과가 없습니다. <Link href="/grading/ocr">4단계 판독</Link>을 먼저 실행하세요.</p></section>;
  }
  const remaining = r.readQueue.filter(q => !q.reviewed).length;
  const essaysLeft = r.essayQueue.filter(q => g.essayReview[reviewKey(q.code, q.no)]?.final == null).length;

  return (
    <>
      <section className="grading-card">
        <header><span>5</span><h3>판독 확인</h3><p>판독이 불확실한 답입니다. 맞으면 &quot;맞음&quot;에 체크하고, 틀리면 &quot;수정&quot;에 바른 답을 적으세요. 처리한 행은 회색으로 남아 되돌릴 수 있습니다.</p></header>
        <h4>{r.readQueue.length}건 중 {remaining}건 남음</h4>
        {r.readQueue.length === 0 ? <p className="helper-line">확인할 판독이 없습니다.</p> :
          <div className="table-scroll small-table"><table><thead><tr><th>학생</th><th>문항</th><th>판독</th><th>신뢰도</th><th>맞음</th><th>수정</th></tr></thead><tbody>
            {r.readQueue.map(q => { const k = reviewKey(q.code, q.no); return <tr key={k} className={q.reviewed ? "reviewed-row" : ""}><td>{q.code}</td><td>{q.no}</td><td>{q.answer}</td><td>{q.confidence}</td>
              <td><input type="checkbox" checked={!!g.readReview[k]?.confirmed} onChange={e => g.setReadReview(v => ({ ...v, [k]: { ...v[k], confirmed: e.target.checked } }))} /></td>
              <td><input className="cell-input" value={g.readReview[k]?.fixed ?? ""} onChange={e => g.setReadReview(v => ({ ...v, [k]: { ...v[k], fixed: e.target.value } }))} /></td></tr>; })}
          </tbody></table></div>}
      </section>

      <section className="grading-card">
        <header><span>5</span><h3>서술형 채점</h3><p>서술형은 교사가 확정합니다. AI 제안은 참고용이며 점수로 들어가지 않습니다. 두 번 채점해 결과가 다르면 표시합니다.</p></header>
        <h4>{r.essayQueue.length}건 중 {essaysLeft}건 남음</h4>
        {r.essayQueue.length > 0 && <div className="table-scroll small-table"><table><thead><tr><th>학생</th><th>문항</th><th>학생 답</th><th>AI 제안</th><th>확정점수</th></tr></thead><tbody>
          {r.essayQueue.map(q => { const k = reviewKey(q.code, q.no); const er = g.essayReview[k] ?? {}; return <tr key={k} className={er.final != null ? "reviewed-row" : ""}><td>{q.code}</td><td>{q.no}<small> /{q.item.points}</small></td>
            <td className="essay-cell" title={q.item.rubric}>{q.answer}</td>
            <td>{er.aiScore != null ? <span className={er.aiUnstable ? "warn-note" : ""}>{er.aiScore}점{er.aiUnstable ? " (두 번 채점 불일치)" : ""}<small>{er.aiEvidence ? ` “${er.aiEvidence}”` : ""}</small></span>
              : <button className="secondary-action" disabled={g.essayBusy === k || (!g.demo && !g.accessKey)} onClick={() => g.suggestEssay(q.code, q.item, q.answer)}>{g.essayBusy === k ? "…" : "AI 제안"}</button>}</td>
            <td><input className="cell-input" type="number" min={0} max={q.item.points} value={er.final ?? ""} onChange={e => g.setEssayReview(v => ({ ...v, [k]: { ...v[k], final: e.target.value === "" ? null : Number(e.target.value) } }))} /></td></tr>; })}
        </tbody></table></div>}
        <div className="step-next"><Link className="primary-action" href="/grading/result">다음: 결과 →</Link></div>
      </section>
    </>
  );
}
