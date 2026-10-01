"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { AppHeader } from "../components/AppHeader";
import { useGrading } from "./GradingContext";

export const STEPS = [
  { href: "/grading", label: "학생 번호" },
  { href: "/grading/key", label: "시험지" },
  { href: "/grading/photos", label: "학생 답안" },
  { href: "/grading/ocr", label: "판독" },
  { href: "/grading/review", label: "판독 확인" },
  { href: "/grading/essay", label: "서술형 채점" },
  { href: "/grading/result", label: "결과" },
];

export default function GradingLayout({ children }: { children: ReactNode }) {
  return (
    <main>
      <AppHeader active="grading" title="시험지 채점" description="PDF 두 개로: 빈 시험지(정답 포함) → 학생 답안 스캔 → 판독·채점 → 교사 확인 → 결과·분석" />
      <div className="grading-page">
        <StepBar />
        {children}
      </div>
    </main>
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
    g.result != null && g.result.readQueue.every(q => q.reviewed) && !g.result.rows.some(r => r.표시.includes("판독확인필요")),
    g.result != null && g.result.essayQueue.every(q => g.essayReview[`${q.code}|${q.no}`]?.final != null),
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
        {g.useCells
          ? <span className={g.health?.cells?.ready ? "ok-note" : "warn-note"}>{g.health == null ? "서버 확인 중…" : g.health.cells?.ready ? `칸 판독 준비됨 (${g.health.cells.a}${g.health.cells.b ? ` + ${g.health.cells.b}` : ""})` : `칸 판독 설정 필요: ${g.health.cells?.missing.join(", ") ?? ""}`}</span>
          : <span className={g.health?.ready ? "ok-note" : "warn-note"}>{g.health == null ? "서버 확인 중…" : g.health.ready ? `판독 준비됨 (${g.health.model})` : `판독 설정 필요: ${g.health.missing.join(", ")}`}</span>}
        <button className="secondary-action" onClick={demo} disabled={g.processing}>{g.processing ? "가상 반 준비 중…" : "가상 반으로 체험하기"}</button>
      </div>
    </section>
  );
}
