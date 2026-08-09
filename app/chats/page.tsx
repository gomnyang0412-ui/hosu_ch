"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BottomNav from "@/components/BottomNav";
import CharacterAvatar from "@/components/CharacterAvatar";
import { getCharacters, getRooms } from "@/lib/storage";
import type { Character, RoomSummary } from "@/lib/types";

function formatTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

function GroupThumb() {
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-card border border-border text-xl">
      <span aria-hidden>👥</span>
    </div>
  );
}

export default function ChatsPage() {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [roomList, characterList] = await Promise.all([
          getRooms(),
          getCharacters(),
        ]);
        setRooms(roomList);
        setCharacters(characterList);
      } catch {
        setError("채팅 목록을 불러오지 못했어요. 새로고침해 주세요.");
      }
    })();
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-4 pt-5 pb-3">
        <h1 className="text-xl font-bold">채팅</h1>
        <Link
          href="/chats/new"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg text-muted hover:bg-background"
          aria-label="새 1:1 대화방"
        >
          +
        </Link>
      </header>

      <main className="flex-1 px-4 pb-4">
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {rooms === null ? null : rooms.length === 0 ? (
          <p className="mt-8 text-center text-sm text-muted">
            아직 나눈 대화가 없어요.
            <br />
            캐릭터 탭에서 대화를 시작해 보세요.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rooms.map((room) => {
              const character =
                room.kind === "single"
                  ? characters.find((c) => c.id === room.characterId)
                  : undefined;
              const href =
                room.kind === "single"
                  ? `/character/${room.characterId}/chat?universe=${room.universeId}`
                  : `/thread/${room.threadId}?universe=${room.universeId}`;
              const key =
                room.kind === "single"
                  ? `${room.universeId}:${room.characterId}`
                  : `${room.universeId}:${room.threadId}`;
              return (
                <li key={key}>
                  <Link
                    href={href}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
                  >
                    {room.kind === "single" && character ? (
                      <CharacterAvatar character={character} size="md" />
                    ) : (
                      <GroupThumb />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{room.title}</p>
                      <p className="truncate text-sm text-muted">
                        {room.preview}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted">
                      {formatTime(room.updatedAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
