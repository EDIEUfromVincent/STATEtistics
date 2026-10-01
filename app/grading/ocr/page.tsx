"use client";

import Link from "next/link";
import { useMemo } from "react";
import { costKrw, estimateOcr, formatKrw } from "../../lib/assessment/cost";
import { AccountNotice } from "../AccountNotice";
import { useGrading } from "../GradingContext";

export default function OcrStep() {
  const g = useGrading();
  const running = g.progress != null && g.progress.done < g.progress.total;
  const todo = g.students.filter(s => !g.readings[s.code]);
  const readCount = Object.keys(g.readings).length;
  const estimate = useMemo(() => {
    const first = g.pagesByCode.values().next().value ?? [];
    return estimateOcr(todo.length, first.map(p => [p.width, p.height] as [number, number]), g.items.length);
  }, [g.pagesByCode, todo.length, g.items.length]);
  const spent = g.ocrUsage.input + g.ocrUsage.output + g.ocrUsage.thoughts;
  const cells = g.useCells && !g.demo;
  const ready = cells ? g.health?.cells?.ready : g.health?.ready;
  const usdKrw = g.pricing.usdKrw;

  return (
    <section className="grading-card">
      <header><span>4</span><h3>판독</h3><p>{g.demo ? "데모: 서버로 보내지 않고 가상 판독 결과를 씁니다." : cells
          ? "양식 기반 판독: 빈칸과 고르는 칸은 이 브라우저에서 잉크로 판정하고, 손글씨·선택형 칸만 \"빈 양식 칸 | 학생 칸\" 조각으로 판독기에 보냅니다. 쪽 전체와 정답은 보내지 않습니다."
          : "학생 한 명의 가린 쪽을 한 번에 보내 학생이 쓴 답을 그대로 옮겨 적게 합니다. 정답은 보내지 않습니다. 이미 읽은 학생은 다시 보내지 않습니다."}</p></header>
      <AccountNotice />
      {!g.approved && <p className="warn-note">아직 승인된 페이지가 없습니다. <Link href="/grading/photos">3단계</Link>에서 가림을 확인하고 승인하세요.</p>}
      {!g.demo && <div className="grading-row">
        <p className={ready ? "ok-note" : "warn-note"}>
          {g.health == null ? "확인 중…" : cells
            ? g.health.cells?.ready
              ? g.health.cells.b ? `판독 A ${g.health.cells.a} · 판독 B ${g.health.cells.b}` : `판독 ${g.health.cells.a} (단독)`
              : `칸 판독 설정 필요: ${g.health.cells?.missing.join(", ") ?? "서버 업데이트"}`
            : g.health.ready ? `판독 준비됨 (${g.health.model})` : `판독 설정 필요: ${g.health.missing.join(", ")} — 데모는 설정 없이 쓸 수 있습니다`}
        </p>
      </div>}
      {g.approved && !cells && !g.demo && todo.length > 0 && <p className="helper-line">예상 비용: 학생 {todo.length}명 · 요청 {todo.length}번 · {formatKrw(costKrw(estimate, g.pricing))} (요금표 기준 추정)</p>}
      <button className="run-model" disabled={!g.approved || running || todo.length === 0 || (!g.demo && !g.signedIn)} onClick={g.runOcr}>
        {running
          ? `판독 중… ${g.progress!.done}/${g.progress!.total}명`
          : todo.length === 0 && readCount > 0
            ? "모든 학생 판독 완료"
            : g.failedCodes.length
              ? `실패한 학생만 다시 판독 (${todo.length}명)`
              : `판독 시작 (학생 ${todo.length}명)`}<b>→</b>
      </button>
      {g.failedCodes.length > 0 && !running && <div className="model-error">
        <b>판독하지 못한 학생 {g.failedCodes.length}명</b> — 이 학생들은 0점이 아니라 &quot;판독실패(미확정)&quot;로 남습니다. 위 버튼으로 이 학생들만 다시 보낼 수 있습니다.
        {g.progress?.errors.slice(0, 5).map(e => <div key={e}>{e}</div>)}
      </div>}
      {g.cellUsd > 0 && <p className="helper-line">이번 탭에서 쓴 칸 판독 비용({g.health?.cells?.a}): ${g.cellUsd.toFixed(3)} (약 {Math.round(g.cellUsd * usdKrw).toLocaleString()}원, 요금표 기준 추정)</p>}
      {spent > 0 && <p className="helper-line">이번 탭에서 쓴 판독 사용량: 입력 {g.ocrUsage.input.toLocaleString()} · 출력 {g.ocrUsage.output.toLocaleString()}{g.ocrUsage.thoughts ? ` · 생각 ${g.ocrUsage.thoughts.toLocaleString()}` : ""} 토큰 → {formatKrw(costKrw(g.ocrUsage, g.pricing))}</p>}
      {readCount > 0 && <div className="step-next"><span className="ok-note">{readCount}명 판독 완료</span><Link className="primary-action" href="/grading/review">다음: 교사 확인 →</Link></div>}
    </section>
  );
}
