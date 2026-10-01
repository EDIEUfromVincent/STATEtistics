"use client";

// 판독에 필요한 것: 구글 로그인 + 내 Gemini API 키(유료 등급). 확인 판독(Claude)은 Anthropic 키가 있을 때만.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useGrading } from "./GradingContext";

export function AccountNotice({ purpose = "판독" }: { purpose?: string }) {
  const g = useGrading();
  const path = usePathname();
  if (g.demo) return null;
  if (!g.me) return <p className="helper-line">로그인 상태 확인 중…</p>;
  if (!g.me.teacher) {
    return <div className="account-notice warn">
      <span>{purpose}하려면 구글로 로그인하세요. 판독 요금은 선생님 각자의 API 키로 나갑니다.</span>
      {g.me.loginReady ? <a className="primary-action" href={`/api/auth/google?next=${encodeURIComponent(path)}`}>구글로 로그인</a> : <small>서버에 구글 로그인 설정이 아직 없습니다.</small>}
    </div>;
  }
  const k = g.me.keys;
  if (!k?.gemini || !k.geminiPaid) {
    return <div className="account-notice warn">
      <span>{!k?.gemini ? `${purpose}하려면 "내 API 키"에 Gemini API 키를 넣어 주세요.` : "Gemini 키가 유료 등급인지 \"내 API 키\"에서 표시해 주세요 (학생 자료는 유료 등급 키로만 보냅니다)."}</span>
      <Link className="primary-action" href="/settings">내 API 키</Link>
    </div>;
  }
  return <div className="account-notice ok">
    <span>{g.me.teacher.email} · Gemini {k.gemini}{k.anthropic ? ` · 확인 판독 Anthropic ${k.anthropic}` : " · 확인 판독 없음 (Anthropic 키를 넣으면 자동 확정 오류가 줄어듭니다)"}</span>
    <Link className="link-button" href="/settings">키 바꾸기</Link>
  </div>;
}
