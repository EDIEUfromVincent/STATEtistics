"use client";
/* eslint-disable @next/next/no-img-element -- 시험지 이미지는 브라우저 메모리의 blob URL이라 next/image를 쓸 수 없다 */

import Link from "next/link";
import { useState } from "react";
import { costKrw, formatKrw } from "../../lib/assessment/cost";
import { reviewKey } from "../../lib/assessment/records";
import { useGrading } from "../GradingContext";

export default function ReviewStep() {
  const g = useGrading();
  const [viewing, setViewing] = useState<string>("");
  const r = g.result;
  if (!r) {
    return <section className="grading-card"><header><span>5</span><h3>교사 확인</h3></header><p className="warn-note">아직 판독 결과가 없습니다. <Link href="/grading/ocr">4단계 판독</Link>을 먼저 실행하세요.</p></section>;
  }
  const remaining = r.readQueue.filter(q => !q.reviewed).length;
  const fixedCount = r.readQueue.filter(q => g.readReview[reviewKey(q.code, q.no)]?.fixed?.trim()).length;
  const reviewedCount = r.readQueue.length - remaining;
  const essayItems = g.items.filter(it => it.kind === "서술");
  const viewPages = viewing ? g.pagesByCode.get(viewing) ?? [] : [];

  return (
    <>
      <section className="grading-card">
        <header><span>5</span><h3>판독 확인</h3><p>판독이 불확실한 답입니다. 학생 코드를 누르면 그 학생의 시험지가 옆에 뜹니다. 맞으면 &quot;맞음&quot;, 틀리면 &quot;수정&quot;에 바른 답을 적으세요. 처리한 행은 회색으로 남아 되돌릴 수 있습니다.</p></header>
        <label className="approve-check">
          <input type="checkbox" checked={g.reviewAll} onChange={e => g.setReviewAll(e.target.checked)} />
          모든 판독 대조하기 (처음 쓸 때 권장)
        </label>
        <p className="helper-line">판독 확신도는 모델이 스스로 매긴 값이라 잘 맞지 않을 수 있습니다. 처음 몇 번은 전부 대조해서 실제로 얼마나 틀리는지 재 보세요.
          {g.reviewAll && reviewedCount > 0 && <b> 지금까지 {reviewedCount}건 대조, {fixedCount}건 수정 → 오판독률 {Math.round((fixedCount / reviewedCount) * 100)}%</b>}
        </p>
        <h4>{r.readQueue.length}건 중 {remaining}건 남음</h4>
        <div className={viewing ? "review-split" : ""}>
          {r.readQueue.length === 0 ? <p className="helper-line">확인할 판독이 없습니다.</p> :
            <div className="table-scroll small-table"><table><thead><tr><th>학생</th><th>문항</th><th>판독</th><th>신뢰도</th><th>맞음</th><th>수정</th></tr></thead><tbody>
              {r.readQueue.map(q => { const k = reviewKey(q.code, q.no); return <tr key={k} className={q.reviewed ? "reviewed-row" : ""}>
                <td><button className={`link-button ${viewing === q.code ? "on" : ""}`} onClick={() => setViewing(v => (v === q.code ? "" : q.code))}>{q.code}</button></td>
                <td>{q.no}</td><td>{q.answer || <small>(빈칸)</small>}</td><td>{q.confidence}</td>
                <td><input type="checkbox" checked={!!g.readReview[k]?.confirmed} onChange={e => g.setReadReview(v => ({ ...v, [k]: { ...v[k], confirmed: e.target.checked } }))} /></td>
                <td><input className="cell-input" value={g.readReview[k]?.fixed ?? ""} onChange={e => g.setReadReview(v => ({ ...v, [k]: { ...v[k], fixed: e.target.value } }))} /></td></tr>; })}
            </tbody></table></div>}
          {viewing && <div className="page-viewer">
            <header><b>{viewing}</b><button className="link-button" onClick={() => setViewing("")}>닫기</button></header>
            {viewPages.map(p => <figure key={p.file}><img src={p.url} alt={`${viewing} ${p.page}쪽`} /><figcaption>{p.page}쪽</figcaption></figure>)}
          </div>}
        </div>
      </section>

      <section className="grading-card">
        <header><span>5</span><h3>서술형 채점</h3><p>서술형은 교사가 확정합니다. AI 제안은 참고용이며 점수로 들어가지 않습니다. AI 제안은 답마다 한 번만 요청하고, 미심쩍을 때만 &quot;재확인&quot;으로 한 번 더 받아 비교합니다.</p></header>
        {g.essayError && <div className="model-error">{g.essayError}</div>}
        {essayItems.map(it => {
          const queue = r.essayQueue.filter(q => q.no === it.no);
          const left = queue.filter(q => g.essayReview[reviewKey(q.code, q.no)]?.final == null).length;
          const noSuggestion = queue.filter(q => g.essayReview[reviewKey(q.code, q.no)]?.aiScore == null).length;
          return <div className="essay-block" key={it.no}>
            <div className="rubric-box">
              <b>{it.no}번 · 배점 {it.points}점 · {it.standard}</b>
              <p>{it.rubric}</p>
            </div>
            <div className="grading-actions">
              <span className="helper-line">{queue.length}명 중 {left}명 남음</span>
              {!g.demo && noSuggestion > 0 && <button className="secondary-action" disabled={!!g.essayBusy || !g.accessKey} onClick={() => g.suggestAllEssays(it)}>이 문항 AI 제안 모두 받기 ({noSuggestion}명)</button>}
            </div>
            {queue.length > 0 && <div className="table-scroll small-table"><table><thead><tr><th>학생</th><th>학생 답</th><th>AI 제안</th><th>확정점수</th></tr></thead><tbody>
              {queue.map(q => { const k = reviewKey(q.code, q.no); const er = g.essayReview[k] ?? {}; return <tr key={k} className={er.final != null ? "reviewed-row" : ""}>
                <td><button className="link-button" onClick={() => setViewing(q.code)}>{q.code}</button></td>
                <td className="essay-cell">{q.answer}</td>
                <td>{er.aiScore != null
                  ? <span className={er.aiUnstable ? "warn-note" : ""}>{er.aiScore}점{er.aiUnstable ? " (재확인 결과 다름)" : er.aiUnstable === false ? " (재확인 일치)" : ""}<small>{er.aiEvidence ? ` “${er.aiEvidence}”` : ""}</small>
                    {er.aiUnstable == null && <button className="link-button" disabled={g.essayBusy === k} onClick={() => g.suggestEssay(q.code, q.item, q.answer, true).catch(() => {})}>재확인</button>}</span>
                  : <button className="secondary-action" disabled={!!g.essayBusy || (!g.demo && !g.accessKey)} onClick={() => g.suggestEssay(q.code, q.item, q.answer).catch(() => {})}>{g.essayBusy === k ? "…" : "AI 제안"}</button>}</td>
                <td><input className="cell-input" type="number" min={0} max={q.item.points} value={er.final ?? ""} onChange={e => g.setEssayReview(v => ({ ...v, [k]: { ...v[k], final: e.target.value === "" ? null : Number(e.target.value) } }))} /></td></tr>; })}
            </tbody></table></div>}
          </div>;
        })}
        {essayItems.length === 0 && <p className="helper-line">서술형 문항이 없습니다.</p>}
        {g.essayUsage.input > 0 && <p className="helper-line">서술형 AI 제안 사용량: {formatKrw(costKrw(g.essayUsage, g.pricing))}</p>}
        <div className="step-next"><Link className="primary-action" href="/grading/result">다음: 결과 →</Link></div>
      </section>
    </>
  );
}
