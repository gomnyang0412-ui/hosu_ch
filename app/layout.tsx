import type { Metadata, Viewport } from "next";
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
        <Sidebar />
        <div className="flex w-full flex-1 justify-center">
          <div className="flex w-full max-w-[480px] flex-1 flex-col md:max-w-[720px] md:px-6 lg:px-10 lg:py-8">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
