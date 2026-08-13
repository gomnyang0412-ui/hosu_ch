"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import CharacterAvatar from "@/components/CharacterAvatar";
import TopBar from "@/components/TopBar";
import {
  getCharacters,
  getChatHistory,
  getUniverse,
  saveRoom,
  StorageError,
} from "@/lib/storage";
import { resolveUniverseTemplate } from "@/lib/template";
import {
  ORG_UNIVERSE_ID,
  createOrgUniverse,
  toCharacterProfile,
  type Character,
  type Room,
  type RoomItem,
  type Universe,
} from "@/lib/types";

export default function NewThreadPage() {
  return (
    <Suspense fallback={null}>
      <NewThreadPageInner />
    </Suspense>
  );
}

function NewThreadPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const universeId = searchParams.get("universe") || ORG_UNIVERSE_ID;

  const [universe, setUniverse] = useState<Universe | null>(null);
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hasHistoryIds, setHasHistoryIds] = useState<Set<string>>(new Set());
  const [importIds, setImportIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [chars, foundUniverse] = await Promise.all([
          getCharacters(),
          getUniverse(universeId).catch(() => undefined),
        ]);
        setCharacters(chars);
        setUniverse(foundUniverse ?? createOrgUniverse());
        const withHistory = await Promise.all(
          chars.map(async (c) => {
            const history = await getChatHistory(universeId, c.id).catch(
              () => []
            );
            return history.length > 0 ? c.id : null;
          })
        );
        setHasHistoryIds(
          new Set(withHistory.filter((id): id is string => !!id))
        );
      } catch {
        setError("불러오지 못했어요. 새로고침해 주세요.");
      }
    })();
  }, [universeId]);

  function toggle(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }

  function toggleImport(id: string) {
    setImportIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }

  async function handleCreate() {
    if (selectedIds.length < 2 || creating || !characters || !universe) return;
    setCreating(true);
    setError("");
    try {
      const resolvedUniverse = resolveUniverseTemplate(universe, characters);

      const importedItems: RoomItem[] = [];
      for (const id of importIds) {
        if (!selectedIds.includes(id)) continue;
        const character = characters.find((c) => c.id === id);
        if (!character) continue;
        const history = await getChatHistory(universeId, id).catch(() => []);
        if (history.length === 0) continue;
        const res = await fetch("/api/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            character: toCharacterProfile(character),
            characterId: character.id,
            universe: resolvedUniverse,
            history,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && typeof data.summary === "string" && data.summary.trim()) {
          importedItems.push({ t: "n", text: data.summary.trim(), ts: Date.now() });
        }
      }

      const now = Date.now();
      const thread: Room = {
        id: crypto.randomUUID(),
        universeId,
        kind: "group",
        characterIds: selectedIds,
        items: importedItems,
        createdAt: now,
        updatedAt: now,
      };
      await saveRoom(thread);
      router.replace(`/thread/${thread.id}?universe=${universeId}`);
    } catch (err) {
      setError(
        err instanceof StorageError
          ? err.message
          : "대화방을 만들지 못했어요. 잠시 후 다시 시도해 주세요."
      );
      setCreating(false);
    }
  }

  const isAu = universe && universe.type === "au";

  return (
    <div className="flex flex-1 flex-col">
      <TopBar
        title={`새 대화방${isAu ? ` · ${universe.title}` : ""}`}
      />

      <main className="mx-auto w-full max-w-[680px] flex-1 px-4 py-4">
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {characters === null ? null : characters.length < 2 ? (
          <p className="mt-8 text-center text-sm text-muted">
            멀티 대화방을 쓰려면 캐릭터가 2명 이상 필요해요.
            <br />
            캐릭터 탭에서 먼저 캐릭터를 추가해 주세요.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            <div>
              <p className="mb-2 text-sm font-medium">
                참가할 캐릭터 (2명 이상)
              </p>
              <div className="flex flex-wrap gap-2">
                {characters.map((c) => {
                  const active = selectedIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggle(c.id)}
                      className="flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-sm transition-colors"
                      style={
                        active
                          ? {
                              borderColor: c.accentColor,
                              backgroundColor: `${c.accentColor}1A`,
                              color: c.accentColor,
                            }
                          : { borderColor: "var(--border)" }
                      }
                    >
                      <CharacterAvatar character={c} size="sm" />
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="text-xs text-muted">
              여러 캐릭터가 하나의 이야기를 같이 나눠요. 캐릭터를 바꿔가며
              말을 걸어도 지금까지의 흐름을 모두 기억해요.
            </p>

            {selectedIds.some((id) => hasHistoryIds.has(id)) && (
              <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3">
                <p className="text-sm font-medium">이전 1:1 대화 요약 가져오기</p>
                <p className="text-xs text-muted">
                  체크하면 그 캐릭터와 나눈 1:1 대화를 짧게 요약해서,
                  대화방을 시작하는 지문으로 미리 넣어줘요.
                </p>
                <div className="flex flex-col gap-1.5">
                  {characters
                    .filter((c) => selectedIds.includes(c.id) && hasHistoryIds.has(c.id))
                    .map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={importIds.includes(c.id)}
                          onChange={() => toggleImport(c.id)}
                          className="h-4 w-4"
                        />
                        {c.name}와의 1:1 대화 가져오기
                      </label>
                    ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleCreate}
              disabled={selectedIds.length < 2 || creating}
              className="rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >
              {creating
                ? importIds.length > 0
                  ? "이전 대화 요약하는 중…"
                  : "만드는 중…"
                : "대화방 만들기"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
