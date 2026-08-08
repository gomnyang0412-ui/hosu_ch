"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "캐릭터", icon: "👤" },
  { href: "/chats", label: "채팅", icon: "💬" },
  { href: "/au", label: "AU", icon: "✨" },
  { href: "/observe", label: "관찰", icon: "🎭" },
] as const;

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden shrink-0 border-r border-border bg-card lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-56 lg:flex-col lg:gap-1 lg:px-4 lg:py-6">
      <p className="mb-4 px-2 text-lg font-bold">캐릭터 챗봇</p>
      {TABS.map((tab) => {
        const active =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-primary-soft font-semibold text-primary-strong"
                : "text-muted hover:bg-background"
            }`}
          >
            <span aria-hidden className="text-base leading-none">
              {tab.icon}
            </span>
            {tab.label}
          </Link>
        );
      })}
    </aside>
  );
}
