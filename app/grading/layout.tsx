"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { AppHeader } from "../components/AppHeader";
import { GradingProvider, useGrading } from "./GradingContext";

export const STEPS = [
  { href: "/grading", label: "명부" },
  { href: "/grading/key", label: "정답표" },
  { href: "/grading/photos", label: "사진 · 가림 · 승인" },
  { href: "/grading/ocr", label: "판독" },
  { href: "/grading/review", label: "교사 확인" },
  { href: "/grading/result", label: "결과" },
];

export default function GradingLayout({ children }: { children: ReactNode }) {
  return (
    <GradingProvider>
      <main>
        <AppHeader active="grading" title="시험지 채점" description="사진을 모은 뒤부터: 이름 칸 가림 → 교사 승인 → 판독 → 규칙 채점 → 분석 데이터" />
        <div className="grading-page">
          <StepBar />
          {children}
        </div>
      </main>
    </GradingProvider>
  );
}

function StepBar() {
  const g = useGrading();
  const pathname = usePathname();
  const router = useRouter();
  const done = [
    g.roster.length > 0,
    g.items.length > 0,
    g.approved,
    Object.keys(g.readings).length > 0 && g.failedCodes.length === 0,
    g.result != null && g.result.rows.every(r => r.정오 !== "" && !r.표시.includes("판독확인필요")),
    false,
  ];

  async function demo() {
    if (await g.startDemo()) router.push("/grading/photos");
  }

  return (
    <section className="step-bar">
      <ol>
        {STEPS.map((step, i) => {
          const current = pathname === step.href;
          return <li key={step.href} className={current ? "current" : done[i] ? "done" : ""}><Link href={step.href}><span>{i + 1}</span>{step.label}</Link></li>;
        })}
      </ol>
      <div className="step-side">
        <span className={g.health?.ready ? "ok-note" : "warn-note"}>{g.health == null ? "서버 확인 중…" : g.health.ready ? `판독 준비됨 (${g.health.model})` : `판독 설정 필요: ${g.health.missing.join(", ")}`}</span>
        <button className="secondary-action" onClick={demo} disabled={g.processing}>{g.processing ? "가상 반 준비 중…" : "가상 반으로 체험하기"}</button>
      </div>
    </section>
  );
}
