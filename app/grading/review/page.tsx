"use client";
/* eslint-disable @next/next/no-img-element -- 시험지 이미지는 브라우저 메모리의 blob URL이라 next/image를 쓸 수 없다 */

import Link from "next/link";
import { useState } from "react";
import { accuracyLabel, reasonOf } from "../../lib/assessment/confidence";
import { gradeItem } from "../../lib/assessment/grade";
import { BLANK_FIX, reviewKey } from "../../lib/assessment/records";
import { useGrading } from "../GradingContext";
import { PageFocus } from "../PageFocus";

export default function ReviewStep() {
  const g = useGrading();
  // 원래 시험지 보기: null = 첫 줄을 자동으로, "" = 닫음, 그 밖 = 고른 칸(학생코드|문항)
  const [picked, setPicked] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ src: string; label: string } | null>(null);
  const r = g.result;
  if (!r) {
    return <section className="grading-card"><header><span>5</span><h3>판독 확인</h3></header><p className="warn-note">아직 판독 결과가 없습니다. <Link href="/grading/ocr">4단계 판독</Link>을 먼저 실행하세요.</p></section>;
  }
  const remaining = r.readQueue.filter(q => !q.reviewed).length;
  const fixedCount = r.readQueue.filter(q => g.readReview[reviewKey(q.code, q.no)]?.fixed?.trim()).length;
  const reviewedCount = r.readQueue.length - remaining;
  const focus = picked ?? (r?.readQueue[0] ? reviewKey(r.readQueue[0].code, r.readQueue[0].no) : "") ?? "";
  const focusCode = focus.split("|")[0];
  const focusNo = focus.split("|")[1] ?? "";

  return (
    <>
      <section className="grading-card">
        <header><span>5</span><h3>판독 확인 · 바로잡기</h3><p>AI 판독이 의심스러운 칸입니다. 칸 사진을 보고 맞으면 &quot;AI 답 맞음&quot;, 틀리면 바른 답을 직접 적으세요. 고치면 오른쪽 채점이 바로 다시 계산됩니다. 사진을 누르면 크게, 학생 코드를 누르면 그 학생의 시험지가 뜹니다.</p></header>
        <label className="approve-check">
          <input type="checkbox" checked={g.reviewAll} onChange={e => g.setReviewAll(e.target.checked)} />
          모든 판독 대조하기 (자동 확정된 칸까지 모두 사진으로 보고 고치기)
        </label>
        <p className="helper-line">{g.useCells
          ? "\"AI 정확도\"는 모델이 스스로 매긴 값이 아니라, 6-4반 24명 검증에서 같은 이유로 넘어온 칸의 AI 답이 실제로 맞았던 비율입니다. 높아도 이 칸들에 실제 오류가 모여 있으니 사진은 꼭 보세요."
          : "판독 확신도는 모델이 스스로 매긴 값이라 잘 맞지 않을 수 있습니다. 처음 몇 번은 전부 대조해서 실제로 얼마나 틀리는지 재 보세요."}
          {g.reviewAll && reviewedCount > 0 && <b> 지금까지 {reviewedCount}건 대조, {fixedCount}건 수정 → 오판독률 {Math.round((fixedCount / reviewedCount) * 100)}%</b>}
        </p>
        <h4>{r.readQueue.length}건 중 {remaining}건 남음</h4>
        <div className={focus ? "review-split" : ""}>
          {r.readQueue.length === 0 ? <p className="helper-line">확인할 판독이 없습니다.</p> :
            <div className="table-scroll small-table"><table><thead><tr><th>학생</th><th>문항</th>{g.useCells && <th>학생 칸</th>}<th>AI 판독</th><th>{g.useCells ? "AI 정확도 · 이유" : "신뢰도"}</th><th>바로잡기</th><th>채점</th></tr></thead><tbody>
              {r.readQueue.map(q => {
                const k = reviewKey(q.code, q.no);
                const info = g.cellInfo[k];
                const reading = g.readings[q.code]?.[q.no];
                const note = info?.note || reading?.note || "";
                const item = g.items.find(i => i.no === q.no);
                const review = g.readReview[k] ?? {};
                const fixed = review.fixed?.trim() ?? "";
                const finalAnswer = fixed ? (fixed === BLANK_FIX ? "" : fixed) : q.answer;
                const graded = item ? gradeItem(item, finalAnswer) : null;
                const set = (v: { confirmed?: boolean; fixed?: string }) => g.setReadReview(all => ({ ...all, [k]: { ...all[k], ...v } }));
                return <tr key={k} className={`${q.reviewed ? "reviewed-row" : ""} ${focus === k ? "focused-row" : ""}`} onClick={() => setPicked(k)}>
                  <td><button className={`link-button ${focus === k ? "on" : ""}`} onClick={() => setPicked(k)}>{q.code}</button></td>
                  <td>{q.no}</td>
                  {g.useCells && <td>{info?.crop
                    ? <button className="crop-button" onClick={() => setZoom({ src: info.crop, label: `${q.code} · ${q.no}번` })}><img className="cell-crop" src={info.crop} alt={`${q.code} ${q.no} 칸`} /></button>
                    : <small>시험지 보기</small>}</td>}
                  <td>{q.answer || <small>(빈칸)</small>}{info && info.b != null && info.b !== info.a && <small className="reading-pair">확인 판독: {info.b || "(빈칸)"}</small>}</td>
                  <td>{g.useCells
                    ? (() => { const full = accuracyLabel(reasonOf(note, q.confidence >= 0.7)); return <><b className="accuracy" title={full}>{full.split(" (")[0]}</b><small className="reading-pair">{note || "자동 확정"}</small></>; })()
                    : q.confidence}</td>
                  <td className="fix-cell">
                    <input className="cell-input wide" placeholder="바른 답" value={fixed === BLANK_FIX ? "" : review.fixed ?? ""} onChange={e => set({ fixed: e.target.value, confirmed: false })} />
                    <div className="fix-actions">
                      <button className={`chip ${review.confirmed && !fixed ? "on" : ""}`} onClick={() => set({ confirmed: !(review.confirmed && !fixed), fixed: "" })}>AI 답 맞음</button>
                      {info && info.b != null && info.b !== info.a && <button className="chip" onClick={() => set({ fixed: info.b || BLANK_FIX, confirmed: false })}>확인 판독 채택</button>}
                      <button className={`chip ${fixed === BLANK_FIX ? "on" : ""}`} onClick={() => set({ fixed: fixed === BLANK_FIX ? "" : BLANK_FIX, confirmed: false })}>빈칸으로</button>
                    </div>
                  </td>
                  <td className={graded?.correct === true ? "ok-cell" : graded?.correct === false ? "bad-cell" : ""}>{graded == null ? "" : graded.correct == null ? "교사 판단" : `${graded.correct ? "O" : "X"} · ${graded.score}점`}{fixed && <small className="reading-pair">수정 반영</small>}</td>
                </tr>;
              })}
            </tbody></table></div>}
          {focus && <PageFocus pages={g.pagesByCode.get(focusCode) ?? []} where={g.cellInfo[focus]?.where} label={`${focusCode} · ${focusNo}번`} onClose={() => setPicked("")} />}
        </div>
      </section>

      {zoom && <div className="zoom-overlay" onClick={() => setZoom(null)} role="dialog" aria-label="칸 사진 크게 보기">
        <figure><img src={zoom.src} alt={zoom.label} /><figcaption>{zoom.label} · 누르면 닫힙니다</figcaption></figure>
      </div>}

      <section className="grading-card">
        <div className="step-next"><span className="helper-line">{g.items.some(it => it.kind === "서술") ? "서술형은 다음 단계에서 교사가 채점합니다." : ""}</span><Link className="primary-action" href={g.items.some(it => it.kind === "서술") ? "/grading/essay" : "/grading/result"}>다음: {g.items.some(it => it.kind === "서술") ? "서술형 채점" : "결과"} →</Link></div>
      </section>
    </>
  );
}
