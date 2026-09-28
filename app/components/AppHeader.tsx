import Link from "next/link";

export type ActivePage = "generate" | "dashboard" | "grading" | "analysis" | "studio";

// 메뉴는 데이터의 성격으로 묶는다. 앞 두 묶음은 브라우저 안에서 끝나고, 분석 도구만 외부(Prior Labs)로 나간다.
const groups: Array<{ label: string; items: Array<{ id: ActivePage; href: string; label: string }> }> = [
  { label: "연습 · 합성 데이터", items: [{ id: "generate", href: "/", label: "데이터 생성" }, { id: "dashboard", href: "/dashboard", label: "대시보드" }] },
  { label: "평가 · 실제 데이터", items: [{ id: "grading", href: "/grading", label: "채점" }, { id: "analysis", href: "/analysis", label: "평가 분석" }] },
  { label: "분석 도구", items: [{ id: "studio", href: "/studio", label: "시각화 · TabPFN" }] },
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
    </header>
  );
}
