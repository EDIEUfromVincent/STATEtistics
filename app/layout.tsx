import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "교실 학습데이터 대시보드 | 서울대학교 미래교육혁신센터",
    description: "학교급과 과목별 합성 학습데이터를 살펴보는 인터랙티브 데모 대시보드",
    openGraph: {
      title: "교실 학습데이터 대시보드",
      description: "8종 학습데이터를 한눈에 살펴보는 인터랙티브 데모",
      images: [{ url: image, width: 1732, height: 909, alt: "교실 학습데이터 대시보드" }],
    },
    twitter: { card: "summary_large_image", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
