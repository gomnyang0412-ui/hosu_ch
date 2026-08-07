"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import BottomNav from "@/components/BottomNav";
import CharacterAvatar from "@/components/CharacterAvatar";
import { getCharacters } from "@/lib/storage";
import type { Character } from "@/lib/types";

export default function CharacterListPage() {
  const router = useRouter();
  const [characters, setCharacters] = useState<Character[] | null>(null);

  useEffect(() => {
    setCharacters(getCharacters());
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-4 pt-5 pb-3">
        <h1 className="text-xl font-bold">내 캐릭터</h1>
        <Link
          href="/world"
          className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted"
        >
          🌍 세계관 설정
        </Link>
      </header>

      <main className="flex-1 px-4 pb-4">
        {characters === null ? null : characters.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-2 text-center text-sm text-muted">
            <p>아직 등록된 캐릭터가 없어요.</p>
            <p>아래 버튼으로 첫 캐릭터를 만들어 보세요.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {characters.map((c) => (
              <li key={c.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/character/${c.id}/chat`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") router.push(`/character/${c.id}/chat`);
                  }}
                  className="flex cursor-pointer items-center gap-3 rounded-2xl border border-border bg-card p-3"
                >
                  <CharacterAvatar character={c} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{c.name}</p>
                    <p className="truncate text-sm text-muted">
                      {c.oneLiner || "한 줄 소개가 없어요"}
                    </p>
                  </div>
                  <Link
                    href={`/character/${c.id}/edit`}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`${c.name} 편집`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-background"
                  >
                    ✎
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Link
          href="/character/new"
          className="mt-4 flex w-full items-center justify-center rounded-2xl border border-dashed border-border py-3 text-sm font-medium text-muted"
        >
          + 캐릭터 추가
        </Link>
      </main>

      <BottomNav />
    </div>
  );
}
