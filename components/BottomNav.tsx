"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "캐릭터", icon: "👤" },
  { href: "/observe", label: "관찰", icon: "🎭" },
] as const;

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-10 flex border-t border-border bg-card lg:hidden">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs transition-colors ${
              active ? "text-foreground font-medium" : "text-muted"
            }`}
          >
            <span aria-hidden className="text-lg leading-none">
              {tab.icon}
            </span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
