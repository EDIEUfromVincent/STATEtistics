import { redirect } from "next/navigation";

// 대시보드는 자체 난수로 그리던 고정 차트였다. 평가 분석이 현재 데이터를 성취기준 기준으로 대신한다.
// 예전 링크가 깨지지 않도록 주소는 남겨 두고 평가 분석으로 보낸다.
export default function DashboardPage() {
  redirect("/analysis");
}
