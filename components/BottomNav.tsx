"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "캐릭터", icon: "👤" },
  { href: "/chats", label: "채팅", icon: "💬" },
  { href: "/au", label: "AU", icon: "✨" },
  { href: "/observe", label: "관찰", icon: "🎭" },
] as const;

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="glass card-shadow sticky bottom-0 z-10 flex lg:hidden">
      {TABS.map((tab) => {
        const active =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex flex-1 flex-col items-center gap-1 py-2.5 text-xs"
          >
            <span
              aria-hidden
              className={`flex h-7 w-10 items-center justify-center rounded-full text-lg leading-none transition-colors ${
                active ? "gradient-primary text-primary-foreground" : ""
              }`}
            >
              {tab.icon}
            </span>
            <span className={active ? "font-medium text-primary" : "text-muted"}>
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
