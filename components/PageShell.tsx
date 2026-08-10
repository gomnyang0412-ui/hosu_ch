"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * 채팅 상세(1:1/스레드) 화면은 자체적으로 [목록 패널 + 대화 내용]
 * 3단 레이아웃을 구성하는데, 이 셸이 원래 하던 것처럼 폭을 제한하고
 * 가운데 정렬해버리면 화면 폭에 따라 사이드바와 목록 패널 사이의
 * 여백이 넓어졌다 좁아졌다 한다(centering으로 생기는 좌우 여백 크기가
 * 화면마다 다르기 때문). 이 화면들은 폭 제한 없이 사이드바 바로 옆에
 * 붙여서, 세 번째 컬럼(대화 내용)이 남는 공간을 유동적으로 채우게
 * 한다.
 */
function isWideRoute(pathname: string): boolean {
  if (pathname.startsWith("/thread/")) return true;
  if (/^\/character\/[^/]+\/chat(\/|$)/.test(pathname)) return true;
  return false;
}

export default function PageShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const wide = isWideRoute(pathname);

  if (wide) {
    return (
      <div className="flex w-full flex-1 flex-col lg:px-8 lg:py-6">
        {children}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 justify-center">
      <div className="flex w-full max-w-[480px] flex-1 flex-col md:max-w-[720px] md:px-6 lg:max-w-[1100px] lg:px-8 lg:py-6">
        {children}
      </div>
    </div>
  );
}
