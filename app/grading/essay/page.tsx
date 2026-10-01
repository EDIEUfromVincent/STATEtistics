"use client";
/* eslint-disable @next/next/no-img-element -- 손글씨 사진은 브라우저 메모리의 blob URL이라 next/image를 쓸 수 없다 */

import Link from "next/link";
import { useState } from "react";
import { costKrw, formatKrw } from "../../lib/assessment/cost";
import { reviewKey } from "../../lib/assessment/records";
import { useGrading } from "../GradingContext";
import { PageFocus } from "../PageFocus";

// 서술형은 AI가 점수를 확정하지 않는다. AI 제안은 참고, 점수는 교사가 정하고 언제든 다시 열어 고칠 수 있다.
export default function EssayStep() {
  const g = useGrading();
  // 원래 시험지 보기: null = 첫 줄을 자동으로, "" = 닫음, 그 밖 = 고른 칸(학생코드|문항)
  const [picked, setPicked] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ src: string; label: string } | null>(null);
  const [showBlank, setShowBlank] = useState(false);
  const r = g.result;
  if (!r) {
    return <section className="grading-card"><header><span>6</span><h3>서술형 채점</h3></header><p className="warn-note">아직 판독 결과가 없습니다. <Link href="/grading/ocr">4단계 판독</Link>을 먼저 실행하세요.</p></section>;
  }
  const essayItems = g.items.filter(it => it.kind === "서술");
  const total = r.essayQueue.length;
  const done = r.essayQueue.filter(q => g.essayReview[reviewKey(q.code, q.no)]?.final != null).length;
  const focus = picked ?? (r?.essayQueue[0] ? reviewKey(r.essayQueue[0].code, r.essayQueue[0].no) : "") ?? "";
  const focusCode = focus.split("|")[0];
  const focusNo = focus.split("|")[1] ?? "";

  const setScore = (k: string, value: number | null) => g.setEssayReview(v => ({ ...v, [k]: { ...v[k], final: value } }));
  const setText = (k: string, text: string, original = "") => g.setReadReview(v => ({ ...v, [k]: { ...v[k], fixed: text === original ? "" : text } }));

  return (
    <>
      <section className="grading-card">
        <header><span>6</span><h3>서술형 채점</h3><p>서술형 점수는 교사가 정합니다. 손글씨 사진을 보고, 필요하면 AI가 옮겨 적은 글을 고친 뒤 점수를 누르세요. AI 제안은 참고일 뿐 점수로 들어가지 않습니다. 확정한 점수도 언제든 다시 열어 고칠 수 있고, 결과에서 다시 분석하면 바뀐 점수가 반영됩니다.</p></header>
        <div className="kpi-grid">
          <div className="kpi"><span>서술형 답</span><strong>{total}건</strong><small>{essayItems.length}문항</small></div>
          <div className="kpi"><span>교사 확정</span><strong>{done}건</strong><small className={done < total ? "negative" : ""}>{done < total ? `${total - done}건 남음 · 확정 전에는 정답률에 넣지 않습니다` : "모두 확정됨"}</small></div>
        </div>
        {g.essayError && <div className="model-error">{g.essayError}</div>}
        <label className="approve-check"><input type="checkbox" checked={showBlank} onChange={e => setShowBlank(e.target.checked)} /> 무응답(빈칸)으로 처리된 답도 보기 — 글씨를 놓친 칸이 있으면 글을 적어 채점 목록에 올립니다</label>
      </section>

      <div className={focus ? "review-split" : ""}>
        <div>
          {essayItems.map(it => {
            const queue = r.essayQueue.filter(q => q.no === it.no);
            const left = queue.filter(q => g.essayReview[reviewKey(q.code, q.no)]?.final == null).length;
            const noSuggestion = queue.filter(q => g.essayReview[reviewKey(q.code, q.no)]?.aiScore == null).length;
            const blanks = showBlank ? r.rows.filter(row => row.문항 === it.no && !row.응답 && row.채점방식 !== "판독실패") : [];
            const scores = Array.from({ length: Math.floor(it.points) + 1 }, (_, i) => i);
            return <section className="grading-card essay-block" key={it.no}>
              <div className="rubric-box">
                <b>{it.no}번 · 배점 {it.points}점 · {it.standard}</b>
                <p>{it.rubric}</p>
              </div>
              <div className="grading-actions">
                <span className="helper-line">{queue.length}명 중 {left}명 남음</span>
                {!g.demo && noSuggestion > 0 && <button className="secondary-action" disabled={!!g.essayBusy || !g.signedIn} onClick={() => g.suggestAllEssays(it)}>이 문항 AI 제안 모두 받기 ({noSuggestion}명)</button>}
              </div>
              {queue.length > 0 && <div className="table-scroll small-table"><table><thead><tr><th>학생</th><th>손글씨</th><th>옮겨 적은 글 (고칠 수 있음)</th><th>AI 제안</th><th>교사 점수</th></tr></thead><tbody>
                {queue.map(q => {
                  const k = reviewKey(q.code, q.no);
                  const er = g.essayReview[k] ?? {};
                  const crop = g.cellInfo[k]?.crop;
                  const confirmed = er.final != null;
                  return <tr key={k} className={`${confirmed ? "reviewed-row" : ""} ${focus === k ? "focused-row" : ""}`} onClick={() => setPicked(k)}>
                    <td><button className={`link-button ${focus === k ? "on" : ""}`} onClick={() => setPicked(k)}>{g.label(q.code)}</button></td>
                    <td>{crop ? <button className="crop-button" onClick={() => setZoom({ src: crop, label: `${q.code} · ${q.no}번` })}><img className="cell-crop essay-crop" src={crop} alt={`${q.code} ${q.no} 손글씨`} /></button> : <small>시험지 보기</small>}</td>
                    <td className="essay-cell"><textarea className="essay-text" rows={3} value={g.readReview[k]?.fixed || q.answer} onChange={e => setText(k, e.target.value, g.readings[q.code]?.[q.no]?.answer ?? "")} />
                      {g.cellInfo[k]?.note && <small className="reading-pair">{g.cellInfo[k].note}</small>}</td>
                    <td>{er.aiScore != null
                      ? <span className={er.aiUnstable ? "warn-note" : ""}>{er.aiScore}점{er.aiUnstable ? " (재확인 결과 다름)" : er.aiUnstable === false ? " (재확인 일치)" : ""}<small className="reading-pair">{er.aiEvidence ? `근거: “${er.aiEvidence}”` : ""}</small>
                        {er.aiUnstable == null && <button className="link-button" disabled={g.essayBusy === k} onClick={() => g.suggestEssay(q.code, q.item, q.answer, true).catch(() => {})}>재확인</button>}</span>
                      : <button className="secondary-action" disabled={!!g.essayBusy || (!g.demo && !g.signedIn)} onClick={() => g.suggestEssay(q.code, q.item, q.answer).catch(() => {})}>{g.essayBusy === k ? "…" : "AI 제안"}</button>}</td>
                    <td className="fix-cell">
                      <div className="fix-actions">
                        {scores.map(n => <button key={n} className={`chip ${er.final === n ? "on" : ""}`} onClick={() => setScore(k, n)}>{n}점</button>)}
                        {er.aiScore != null && er.final == null && <button className="chip" onClick={() => setScore(k, er.aiScore!)}>AI 제안대로</button>}
                      </div>
                      <input className="cell-input" type="number" min={0} max={q.item.points} step={0.5} value={er.final ?? ""} placeholder="직접" onChange={e => setScore(k, e.target.value === "" ? null : Math.max(0, Math.min(q.item.points, Number(e.target.value))))} />
                      {confirmed && <button className="link-button" onClick={() => setScore(k, null)}>다시 열기</button>}
                    </td>
                  </tr>;
                })}
              </tbody></table></div>}
              {queue.length === 0 && !blanks.length && <p className="helper-line">이 문항에 답을 쓴 학생이 없습니다.</p>}
              {blanks.length > 0 && <div className="table-scroll small-table"><table><thead><tr><th>무응답 학생</th><th>칸 사진</th><th>글씨가 있으면 적기 → 채점 목록으로</th></tr></thead><tbody>
                {blanks.map(row => {
                  const k = reviewKey(row.학생코드, it.no);
                  const crop = g.cellInfo[k]?.crop;
                  return <tr key={k}>
                    <td>{g.label(row.학생코드)}</td>
                    <td>{crop ? <button className="crop-button" onClick={() => setZoom({ src: crop, label: `${row.학생코드} · ${it.no}번` })}><img className="cell-crop" src={crop} alt={`${row.학생코드} ${it.no} 칸`} /></button> : <small>없음</small>}</td>
                    <td><input className="cell-input wide" placeholder="학생이 쓴 글" value={g.readReview[k]?.fixed ?? ""} onChange={e => setText(k, e.target.value)} /></td>
                  </tr>;
                })}
              </tbody></table></div>}
            </section>;
          })}
          {essayItems.length === 0 && <section className="grading-card"><p className="helper-line">서술형 문항이 없습니다.</p></section>}
        </div>
        {focus && <PageFocus pages={g.pagesByCode.get(focusCode) ?? []} where={g.cellInfo[focus]?.where} label={`${g.label(focusCode)} · ${focusNo}번`} onClose={() => setPicked("")} />}
      </div>

      {zoom && <div className="zoom-overlay" onClick={() => setZoom(null)} role="dialog" aria-label="손글씨 크게 보기">
        <figure><img src={zoom.src} alt={zoom.label} /><figcaption>{zoom.label} · 누르면 닫힙니다</figcaption></figure>
      </div>}

      <section className="grading-card">
        {g.essayUsage.input > 0 && <p className="helper-line">서술형 AI 제안 사용량: {formatKrw(costKrw(g.essayUsage, g.pricing))}</p>}
        <div className="step-next"><Link className="secondary-action" href="/grading/review">← 판독 확인</Link><Link className="primary-action" href="/grading/result">다음: 결과 →</Link></div>
      </section>
    </>
  );
}
