"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { pendingCount } from "../../lib/assessment/records";
import { downloadBlob } from "../../lib/generator";
import { useGrading } from "../GradingContext";

export default function ResultStep() {
  const g = useGrading();
  const router = useRouter();
  const r = g.result;
  if (!r) {
    return <section className="grading-card"><header><span>6</span><h3>결과</h3></header><p className="warn-note">아직 결과가 없습니다. <Link href="/grading/ocr">4단계 판독</Link>을 먼저 실행하세요.</p></section>;
  }
  const pending = pendingCount(r.rows);

  function openAnalysis() {
    sessionStorage.setItem("statetistic:assessmentCsv", g.resultCsv());
    router.push("/analysis");
  }

  return (
    <section className="grading-card">
      <header><span>6</span><h3>결과</h3><p>결과에는 학생 코드만 들어갑니다. 이름으로 되돌릴 때는 보관한 명부 파일을 씁니다.</p></header>
      <div className="kpi-grid">
        <div className="kpi"><span>응시</span><strong>{Object.keys(g.readings).length}명</strong></div>
        <div className="kpi"><span>채점 행</span><strong>{r.rows.length}</strong></div>
        <div className="kpi"><span>교사 확인 대기</span><strong>{pending}</strong><small className={pending ? "negative" : ""}>{pending ? "확정 전 문항은 정답률을 계산하지 않습니다" : "모두 확정됨"}</small></div>
        <div className="kpi"><span>이름 가림</span><strong>{r.rows.filter(x => x.표시.includes("이름가림")).length}건</strong><small>판독 결과에 나온 학생 이름</small></div>
      </div>
      {pending > 0 && <p className="warn-note"><Link href="/grading/review">5단계 교사 확인</Link>에 {pending}건이 남아 있습니다. 지금 내보내면 그 문항은 미확정으로 표시됩니다.</p>}
      <div className="grading-actions">
        <button className="primary-action" onClick={openAnalysis}>평가 분석 열기</button>
        <button className="secondary-action" onClick={() => downloadBlob(`﻿${g.resultCsv()}`, `${g.assessmentId || "평가"}_응답_long.csv`, "text/csv")}>응답_long.csv 내려받기</button>
      </div>
    </section>
  );
}
