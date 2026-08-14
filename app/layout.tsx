import type { Metadata, Viewport } from "next";
import AppBackground from "@/components/AppBackground";
import MemorySync from "@/components/MemorySync";
import PageShell from "@/components/PageShell";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

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
    <html lang="ko" className="h-full antialiased">
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
