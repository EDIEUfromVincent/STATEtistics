"use client";

import Link from "next/link";
import { useGrading } from "../GradingContext";

export default function OcrStep() {
  const g = useGrading();
  const running = g.progress != null && g.progress.done < g.progress.total;
  const finished = Object.keys(g.readings).length > 0;

  return (
    <section className="grading-card">
      <header><span>4</span><h3>판독</h3><p>{g.demo ? "데모: 서버로 보내지 않고 가상 판독 결과를 씁니다." : "가린 페이지를 한 장씩 보내 학생이 쓴 답을 그대로 옮겨 적게 합니다. 정답은 보내지 않습니다."}</p></header>
      {!g.approved && <p className="warn-note">아직 승인된 페이지가 없습니다. <Link href="/grading/photos">3단계</Link>에서 가림을 확인하고 승인하세요.</p>}
      {!g.demo && <div className="grading-row">
        <label className="access-key-control">접속 코드<input type="password" autoComplete="off" value={g.accessKey} onChange={e => g.updateAccessKey(e.target.value)} placeholder="이 브라우저에만 저장됩니다" /></label>
        <p className={g.health?.ready ? "ok-note" : "warn-note"}>
          {g.health == null ? "확인 중…" : g.health.ready ? `판독 준비됨 (${g.health.model})` : `판독 설정 필요: ${g.health.missing.join(", ")} — 데모는 설정 없이 쓸 수 있습니다`}
        </p>
      </div>}
      <button className="run-model" disabled={!g.approved || running || (!g.demo && !g.accessKey)} onClick={g.runOcr}>
        {running ? `판독 중… ${g.progress!.done}/${g.progress!.total}` : `판독 시작 (가린 페이지 ${g.pages.length}장)`}<b>→</b>
      </button>
      {g.progress?.errors.length ? <div className="model-error">{g.progress.errors.slice(0, 5).map(e => <div key={e}>{e}</div>)}</div> : null}
      {finished && <div className="step-next"><span className="ok-note">{Object.keys(g.readings).length}명 판독 완료</span><Link className="primary-action" href="/grading/review">다음: 교사 확인 →</Link></div>}
    </section>
  );
}
