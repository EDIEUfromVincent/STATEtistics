"use client";

import Link from "next/link";
import { useMemo } from "react";
import { clearCurrentDataset, parseDataset, useCurrentDatasetRaw } from "../lib/dataset";

export type ActivePage = "generate" | "grading" | "import" | "analysis" | "studio";

// 들여오는 단계와 쓰는 단계로 나눈다. 데이터를 들여오는 곳은 ① 준비뿐이고, ② 분석은 현재 데이터만 읽는다.
const groups: Array<{ label: string; items: Array<{ id: ActivePage; href: string; label: string }> }> = [
  {
    label: "① 데이터 준비",
    items: [
      { id: "generate", href: "/", label: "합성 데이터 생성" },
      { id: "grading", href: "/grading", label: "시험지 채점" },
      { id: "import", href: "/import", label: "CSV 가져오기" },
    ],
  },
  {
    label: "② 분석",
    items: [
      { id: "analysis", href: "/analysis", label: "평가 분석" },
      { id: "studio", href: "/studio", label: "시각화 · 예측" },
    ],
  },
];

export function AppHeader({ active, title, description }: { active: ActivePage; title: string; description: string }) {
  return (
    <header className="topbar">
      <Link href="/" className="wordmark" aria-label="STATEtistic 홈">
        <span>STATE</span>tistic
        <small>PERSONAL DATA LAB</small>
      </Link>
      <div className="heading">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="topbar-right">
        <nav aria-label="주요 메뉴" className="nav-groups">
          {groups.map(group => {
            const current = group.items.some(item => item.id === active);
            return (
              <div key={group.label} className={current ? "nav-group current" : "nav-group"}>
                <span>{group.label}</span>
                <div>{group.items.map(item => <Link key={item.id} className={item.id === active ? "active" : ""} href={item.href}>{item.label}</Link>)}</div>
              </div>
            );
          })}
        </nav>
        <CurrentDatasetChip />
      </div>
    </header>
  );
}

function CurrentDatasetChip() {
  const raw = useCurrentDatasetRaw();
  const dataset = useMemo(() => parseDataset(raw), [raw]);
  if (!dataset) return <div className="dataset-chip empty">현재 데이터 없음</div>;
  return (
    <div className={`dataset-chip ${dataset.real ? "real" : ""}`}>
      <span>{dataset.real ? "실제" : "합성"}</span>
      <b title={dataset.name}>{dataset.name}</b>
      <small>{dataset.rows.length.toLocaleString()}행</small>
      <button onClick={() => { if (confirm("현재 데이터를 이 탭에서 지울까요?")) clearCurrentDataset(); }} aria-label="현재 데이터 지우기">×</button>
    </div>
  );
}
