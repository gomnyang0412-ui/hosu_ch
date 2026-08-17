"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChatBubbleIcon,
  PersonIcon,
  SettingsGearIcon,
  SparkleIcon,
  TheaterMasksIcon,
} from "@/components/icons";

const TABS = [
  { href: "/", label: "캐릭터", Icon: PersonIcon },
  { href: "/chats", label: "채팅", Icon: ChatBubbleIcon },
  { href: "/au", label: "AU", Icon: SparkleIcon },
  { href: "/observe", label: "관찰", Icon: TheaterMasksIcon },
] as const;

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="glass hidden shrink-0 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-56 lg:flex-col lg:gap-1 lg:px-4 lg:py-6">
      <p className="mb-4 px-2 text-lg font-bold">hiátus</p>
      {TABS.map((tab) => {
        const active =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm transition-colors transition-transform hover:scale-[1.02] active:scale-[0.98] ${
              active
                ? "gradient-primary font-semibold text-primary-foreground shadow-[0_4px_12px_-4px_var(--primary-strong)]"
                : "text-muted hover:bg-background"
            }`}
          >
            <span aria-hidden className="text-base leading-none">
              <tab.Icon />
            </span>
            {tab.label}
          </Link>
        );
      })}
      <Link
        href="/settings"
        className={`mt-auto flex items-center gap-2 rounded-full px-3 py-2 text-sm transition-colors transition-transform hover:scale-[1.02] active:scale-[0.98] ${
          pathname === "/settings"
            ? "gradient-primary font-semibold text-primary-foreground shadow-[0_4px_12px_-4px_var(--primary-strong)]"
            : "text-muted hover:bg-background"
        }`}
      >
        <span aria-hidden className="text-base leading-none">
          <SettingsGearIcon />
        </span>
        설정
      </Link>
    </aside>
  );
}
