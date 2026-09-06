import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import AppBackground from "@/components/AppBackground";
import MemorySync from "@/components/MemorySync";
import PageShell from "@/components/PageShell";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

// 본문 폰트를 리디바탕(RIDIBatang)으로 교체(2026-09-06, 사용자가 직접
// 폰트 파일을 올려서 요청). next/font/local이 빌드 시 자체 호스팅
// + 프리로드 + font-display: swap을 자동으로 처리해줘서, Pretendard처럼
// <head>에 수동 <link>를 넣는 대신 이 방식을 썼다. 생성된 CSS 변수를
// globals.css의 --font-sans 맨 앞에 꽂아 넣는 식으로 연결한다 —
// Pretendard CDN 링크는 리디바탕에 없는 글리프(이모지, 일부 기호 등)를
// 위한 폴백으로 그대로 남겨둔다.
const ridiBatang = localFont({
  src: "./fonts/RIDIBatang.otf",
  variable: "--font-ridibatang",
  display: "swap",
});

export const metadata: Metadata = {
  title: "hiátus",
  description: "내가 만든 캐릭터와 대화하고, 캐릭터들끼리의 장면을 관찰하는 앱",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // 모바일 키보드가 올라올 때 페이지 콘텐츠 높이 자체가 줄어들게 해서
  // 하단 입력창이 키보드에 가려지지 않게 한다 (지원하는 브라우저에서).
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`h-full antialiased ${ridiBatang.variable}`}>
      <head>
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css"
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground lg:flex-row">
        <AppBackground />
        <MemorySync />
        <Sidebar />
        <PageShell>{children}</PageShell>
      </body>
    </html>
  );
}
