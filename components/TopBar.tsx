"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export default function TopBar({
  title,
  onBack,
  right,
}: {
  title: string;
  /** 지정하지 않으면 router.back()으로 이동 */
  onBack?: () => void;
  right?: ReactNode;
}) {
  const router = useRouter();

  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-3 py-3">
      <button
        type="button"
        onClick={() => (onBack ? onBack() : router.back())}
        aria-label="뒤로 가기"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg text-muted hover:bg-background"
      >
        ←
      </button>
      <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
      {right}
    </header>
  );
}
