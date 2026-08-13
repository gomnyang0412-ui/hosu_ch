"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import CharacterAvatar from "@/components/CharacterAvatar";
import {
  exportAllData,
  getCharacters,
  getRooms,
  importAllData,
} from "@/lib/storage";
import type { Character, FullExport, RoomSummary } from "@/lib/types";

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
    <div className="card-shadow flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-card text-xl">
      <span aria-hidden>👥</span>
    </div>
  );
}

function roomHref(room: RoomSummary): string {
  return room.kind === "single"
    ? `/character/${room.characterId}/chat?universe=${room.universeId}`
    : `/thread/${room.threadId}?universe=${room.universeId}`;
}

/**
 * 방 목록(카톡식 통합 리스트)을 렌더링하는 재사용 컴포넌트.
 * /chats 페이지의 본문으로도, 데스크톱 3단 레이아웃에서 채팅 상세
 * 옆에 고정으로 붙는 패널로도 그대로 쓴다.
 */
export default function ChatListPane({
  activeHref,
  showHeader = true,
}: {
  /** 지금 열려 있는 방의 href. 패널 안에서 이 항목만 강조 표시한다 */
  activeHref?: string;
  showHeader?: boolean;
}) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [error, setError] = useState("");
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    setError("");
    try {
      const data = await exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date(data.exportedAt).toISOString().slice(0, 10);
      a.href = url;
      a.download = `hiatus-backup-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("전체 데이터를 내보내지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setExporting(false);
    }
  }

  function handleImportClick() {
    if (importing) return;
    fileInputRef.current?.click();
  }

  async function handleImportFileChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (
      !confirm(
        "백업 파일을 불러오면 지금 저장된 모든 캐릭터·세계관·대화·이야기가 이 파일 내용으로 완전히 대체돼요. 되돌릴 수 없어요. 계속할까요?"
      )
    ) {
      return;
    }

    setImporting(true);
    setError("");
    try {
      const text = await file.text();
      let data: FullExport;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("올바른 백업 파일이 아니에요.");
      }
      if (!Array.isArray(data.characters) || !Array.isArray(data.universes)) {
        throw new Error("올바른 백업 파일이 아니에요.");
      }
      await importAllData(data);
      // 캐릭터/세계관/대화 등 앱 전체 상태가 통째로 바뀌었으니, 개별
      // 화면 state를 하나씩 갱신하는 대신 페이지 전체를 새로고침한다.
      window.location.reload();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
      );
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      {showHeader && (
        <header className="flex items-center justify-between px-1 pb-3">
          <h1 className="text-xl font-bold">채팅</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              aria-label="전체 데이터 내보내기"
              title="전체 데이터 내보내기"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg text-muted hover:bg-background disabled:opacity-40"
            >
              {exporting ? "…" : "⬇"}
            </button>
            <button
              type="button"
              onClick={handleImportClick}
              disabled={importing}
              aria-label="백업 파일 불러오기"
              title="백업 파일 불러오기"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg text-muted hover:bg-background disabled:opacity-40"
            >
              {importing ? "…" : "⬆"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={handleImportFileChange}
              className="hidden"
            />
            <div className="relative">
            <button
              type="button"
              onClick={() => setNewMenuOpen((v) => !v)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg text-muted hover:bg-background"
              aria-label="새 대화 만들기"
            >
              +
            </button>
            {newMenuOpen && (
              <>
                <button
                  type="button"
                  aria-label="메뉴 닫기"
                  onClick={() => setNewMenuOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div className="card-shadow absolute right-0 top-9 z-20 flex w-48 flex-col overflow-hidden rounded-2xl bg-card">
                  <Link
                    href="/chats/new"
                    onClick={() => setNewMenuOpen(false)}
                    className="px-4 py-3 text-left text-sm hover:bg-background"
                  >
                    💬 1:1 대화 시작
                  </Link>
                  <Link
                    href="/thread/new"
                    onClick={() => setNewMenuOpen(false)}
                    className="border-t border-border px-4 py-3 text-left text-sm hover:bg-background"
                  >
                    👥 멀티 대화방 만들기
                  </Link>
                </div>
              </>
            )}
            </div>
          </div>
        </header>
      )}

      {error && <p className="mb-3 px-1 text-sm text-red-600">{error}</p>}

      {rooms === null ? null : rooms.length === 0 ? (
        <p className="mt-8 px-1 text-center text-sm text-muted">
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
            const href = roomHref(room);
            const key =
              room.kind === "single"
                ? `${room.universeId}:${room.characterId}`
                : `${room.universeId}:${room.threadId}`;
            const active = activeHref === href;
            return (
              <li key={key}>
                <Link
                  href={href}
                  className={`card-shadow flex items-center gap-3 rounded-2xl bg-card p-3 transition-colors ${
                    active ? "ring-2 ring-primary/60" : ""
                  }`}
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
    </div>
  );
}
