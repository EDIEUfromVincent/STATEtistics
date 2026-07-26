import Link from "next/link";

type ActivePage = "generate" | "dashboard" | "studio";

export function AppHeader({
  active,
  title,
  description,
}: {
  active: ActivePage;
  title: string;
  description: string;
}) {
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
      <nav aria-label="주요 메뉴">
        <Link className={active === "generate" ? "active" : ""} href="/">데이터 생성</Link>
        <Link className={active === "dashboard" ? "active" : ""} href="/dashboard">대시보드</Link>
        <Link className={active === "studio" ? "active" : ""} href="/studio">시각화 · TabPFN</Link>
      </nav>
    </header>
  );
}
