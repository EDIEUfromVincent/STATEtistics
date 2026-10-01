"use client";

import Link from "next/link";
import { useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { useGrading } from "../grading/GradingContext";
import { GEMINI_MODELS, geminiModelOf } from "../lib/assessment/models";

// 선생님 각자의 API 키. 판독 요금은 이 키로 나간다. 키는 서버에 암호화해 저장하고 화면에는 끝 네 자리만 보인다.
export default function SettingsPage() {
  const g = useGrading();
  const [gemini, setGemini] = useState("");
  const [paid, setPaid] = useState<boolean | null>(null);
  const [anthropic, setAnthropic] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const k = g.me?.keys;
  const paidChecked = paid ?? Boolean(k?.geminiPaid);

  async function save(body: Record<string, unknown>, what: string) {
    setBusy(what);
    setMessage(null);
    try {
      const r = await fetch("/api/settings/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "저장하지 못했습니다.");
      setGemini("");
      setAnthropic("");
      setPaid(null);
      setMessage({ ok: true, text: `${what} 저장했습니다.` });
      await g.refreshMe();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("");
    }
  }

  return (
    <main>
      <AppHeader active="settings" title="내 API 키" description="판독 요금은 선생님 각자의 키로 나갑니다. 키는 암호화해 저장하고, 화면에는 끝 네 자리만 보입니다." />
      <div className="grading-page">
        {!g.me ? <p className="helper-line">확인 중…</p> : !g.me.teacher ? (
          <section className="grading-card">
            <header><h3>먼저 구글로 로그인하세요</h3><p>로그인하면 선생님마다 따로 키와 채점 기록을 둡니다.</p></header>
            {g.me.loginReady ? <a className="primary-action" href="/api/auth/google?next=/settings">구글로 로그인</a> : <p className="warn-note">서버에 구글 로그인 설정이 아직 없습니다.</p>}
          </section>
        ) : <>
          <section className="grading-card">
            <header><h3>Gemini API 키 (필수)</h3><p>답 칸 판독, 정답표 초안, 반·번호 판독, 서술형 제안에 씁니다. 요금은 아래에서 고른 모델에 따라 다릅니다.</p></header>
            <p className={k?.gemini ? "ok-note" : "warn-note"}>{k?.gemini ? `저장된 키 ${k.gemini}${k.geminiPaid ? " · 유료 등급" : " · 유료 등급 표시 안 됨"}` : "아직 키가 없습니다."}</p>
            <ol className="helper-line">
              <li><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio → API 키</a>에서 키를 만듭니다.</li>
              <li>학생 자료를 보내므로 <b>결제(유료 등급)를 연결한 프로젝트의 키</b>여야 합니다. 무료 등급은 입력이 구글의 제품 개선에 쓰일 수 있습니다.</li>
            </ol>
            <div className="grading-row">
              <label className="access-key-control">새 Gemini 키<input type="password" autoComplete="off" value={gemini} onChange={e => setGemini(e.target.value)} placeholder="AIza…" /></label>
            </div>
            <label className="approve-check"><input type="checkbox" checked={paidChecked} onChange={e => setPaid(e.target.checked)} /> 결제를 연결한 유료 등급 키입니다</label>
            <div className="grading-actions">
              <button className="primary-action" disabled={!!busy || (!gemini && paid == null)} onClick={() => save({ ...(gemini ? { gemini } : {}), geminiPaid: paidChecked }, "Gemini 키를")}>{busy === "Gemini 키를" ? "확인 중…" : "저장"}</button>
              {k?.gemini && <button className="secondary-action" disabled={!!busy} onClick={() => save({ clear: "gemini" }, "Gemini 키 삭제를")}>키 지우기</button>}
            </div>
          </section>
          <section className="grading-card">
            <header><h3>판독 모델 (Gemini)</h3><p>고른 모델이 답 칸 판독·정답표 초안·반·번호 판독에 모두 쓰입니다. 요금은 공개 요금표로 잰 추정이고, 실제 청구액은 Google 결제 화면이 기준입니다.</p></header>
            <div className="model-choices">
              {GEMINI_MODELS.map(m => {
                const on = geminiModelOf(k?.geminiModel).id === m.id;
                return <label key={m.id} className={`model-choice${on ? " on" : ""}`}>
                  <input type="radio" name="gemini-model" checked={on} disabled={!!busy} onChange={() => save({ geminiModel: m.id }, `판독 모델(${m.label})을`)} />
                  <b>{m.label}</b>
                  <span>{m.perClass}</span>
                  <small>{m.note} · 입력 ${m.input} / 출력 ${m.output} (100만 토큰당)</small>
                </label>;
              })}
            </div>
          </section>
          <section className="grading-card">
            <header><h3>Anthropic API 키 (권장)</h3><p>Gemini가 &quot;정답&quot;으로 읽은 칸을 Claude Sonnet이 한 번 더 읽어 확인합니다. 6-4반 검증에서 자동 확정 오류가 약 8칸 → 2칸으로 줄었습니다. 한 반에 약 1,100원(추정)이 더 듭니다.</p></header>
            <p className={k?.anthropic ? "ok-note" : "helper-line"}>{k?.anthropic ? `저장된 키 ${k.anthropic}` : "키가 없으면 확인 판독 없이 Gemini만으로 판독합니다."}</p>
            <ol className="helper-line"><li><a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Anthropic 콘솔 → API Keys</a>에서 키를 만듭니다.</li></ol>
            <div className="grading-row">
              <label className="access-key-control">새 Anthropic 키<input type="password" autoComplete="off" value={anthropic} onChange={e => setAnthropic(e.target.value)} placeholder="sk-ant-…" /></label>
            </div>
            <div className="grading-actions">
              <button className="primary-action" disabled={!!busy || !anthropic} onClick={() => save({ anthropic }, "Anthropic 키를")}>{busy === "Anthropic 키를" ? "확인 중…" : "저장"}</button>
              {k?.anthropic && <button className="secondary-action" disabled={!!busy} onClick={() => save({ clear: "anthropic" }, "Anthropic 키 삭제를")}>키 지우기</button>}
            </div>
          </section>
          {message && <div className={message.ok ? "ok-note" : "model-error"}>{message.text}</div>}
          <div className="step-next"><Link className="primary-action" href="/grading">시험지 채점으로 →</Link></div>
        </>}
      </div>
    </main>
  );
}
