import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "STATEtistic | Personal Data Lab",
    description: "합성 CSV 생성부터 커스텀 시각화와 TabPFN 예측까지 이어지는 개인 데이터 실험실",
    openGraph: {
      title: "STATEtistic · Personal Data Lab",
      description: "Generate, visualize, and predict from your own CSV data.",
      images: [{ url: image, width: 1732, height: 909, alt: "STATEtistic Personal Data Lab" }],
    },
    twitter: { card: "summary_large_image", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
