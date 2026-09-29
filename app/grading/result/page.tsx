"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { addUsage, costKrw, formatKrw } from "../../lib/assessment/cost";
import { pendingCount, READ_FAILED } from "../../lib/assessment/records";
import { setCurrentDataset } from "../../lib/dataset";
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
  const failedRows = r.rows.filter(x => x.채점방식 === READ_FAILED).length;
  const totalUsage = addUsage(g.ocrUsage, g.essayUsage);

  function analyze() {
    setCurrentDataset({ name: g.assessmentId || "채점 결과", source: "채점", real: !g.demo, csv: g.resultCsv() });
    router.push("/analysis");
  }

  return (
    <section className="grading-card">
      <header><span>6</span><h3>결과</h3><p>결과에는 학생 코드만 들어갑니다. 이름으로 되돌릴 때는 보관한 명부 파일을 씁니다.</p></header>
      <div className="kpi-grid">
        <div className="kpi"><span>응시</span><strong>{g.students.length}명</strong><small>{g.failedCodes.length ? `판독 실패 ${g.failedCodes.length}명` : "모두 판독됨"}</small></div>
        <div className="kpi"><span>채점 행</span><strong>{r.rows.length}</strong></div>
        <div className="kpi"><span>교사 확인 대기</span><strong>{pending}</strong><small className={pending ? "negative" : ""}>{pending ? "확정 전 문항은 정답률을 계산하지 않습니다" : "모두 확정됨"}</small></div>
        <div className="kpi"><span>AI 사용 비용</span><strong>{g.demo ? "0원" : formatKrw(costKrw(totalUsage, g.pricing))}</strong><small>{g.demo ? "데모는 전송하지 않음" : "토큰 사용량 기준 추정"}</small></div>
      </div>
      {failedRows > 0 && <p className="warn-note"><Link href="/grading/ocr">4단계</Link>에서 판독하지 못한 학생 {g.failedCodes.length}명이 남아 있습니다. 이 학생들의 문항은 미확정으로 표시됩니다.</p>}
      {pending > failedRows && <p className="warn-note"><Link href="/grading/review">5단계 교사 확인</Link>에 {pending - failedRows}건이 남아 있습니다. 지금 분석하면 그 문항은 미확정으로 표시됩니다.</p>}
      <div className="grading-actions">
        <button className="primary-action" onClick={analyze}>이 결과로 분석하기 →</button>
        <button className="secondary-action" onClick={() => downloadBlob(`﻿${g.resultCsv()}`, `${g.assessmentId || "평가"}_응답_long.csv`, "text/csv")}>응답_long.csv 내려받기</button>
      </div>
    </section>
  );
}
