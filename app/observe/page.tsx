"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import BottomNav from "@/components/BottomNav";
import CharacterAvatar from "@/components/CharacterAvatar";
import {
  getCharacters,
  getChatHistory,
  getStories,
  getUniverse,
  saveStory,
  deleteStory,
  saveRoom,
} from "@/lib/storage";
import { resolveUniverseTemplate } from "@/lib/template";
import {
  ORG_UNIVERSE_ID,
  createOrgUniverse,
  toCharacterProfile,
  type Character,
  type ObservationSession,
  type Room,
  type StoryEpisode,
  type Universe,
} from "@/lib/types";

interface SceneErrorState {
  message: string;
  kind: "quota" | "network" | "overloaded" | "unknown" | "parse";
}

function storyTitle(session: ObservationSession, characters: Character[]): string {
  const names = session.characterIds
    .map((id) => characters.find((c) => c.id === id)?.name)
    .filter((n): n is string => !!n);
  const namePart = names.join(" X ") || "이야기";
  return session.topic.trim() ? `${namePart} · ${session.topic.trim()}` : namePart;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
  });
}

export default function ObservePage() {
  return (
    <Suspense fallback={null}>
      <ObservePageInner />
    </Suspense>
  );
}

function ObservePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const universeId = searchParams.get("universe") || ORG_UNIVERSE_ID;
  const storyId = searchParams.get("story");

  const [universe, setUniverse] = useState<Universe | null>(null);
  const [allCharacters, setAllCharacters] = useState<Character[]>([]);
  const [stories, setStories] = useState<ObservationSession[] | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hasHistoryIds, setHasHistoryIds] = useState<Set<string>>(new Set());
  const [importIds, setImportIds] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [directive, setDirective] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SceneErrorState | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [startingChat, setStartingChat] = useState(false);
  const [startChatError, setStartChatError] = useState("");

  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setStories(null);
    setShowNewForm(false);
    setSelectedIds([]);
    setImportIds([]);
    setTopic("");
    setDirective("");
    setError(null);
    (async () => {
      try {
        const [characters, storyList, foundUniverse] = await Promise.all([
          getCharacters(),
          getStories(universeId),
          getUniverse(universeId).catch(() => undefined),
        ]);
        setAllCharacters(characters);
        setStories(storyList);
        const resolvedFoundUniverse = foundUniverse ?? createOrgUniverse();
        setUniverse(resolvedFoundUniverse);
        if (
          resolvedFoundUniverse.type === "au" &&
          resolvedFoundUniverse.roleA &&
          resolvedFoundUniverse.roleB
        ) {
          setSelectedIds([
            resolvedFoundUniverse.roleA,
            resolvedFoundUniverse.roleB,
          ]);
        }
        const withHistory = await Promise.all(
          characters.map(async (c) => {
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
        setLoadError("불러오지 못했어요. 새로고침해 주세요.");
        setStories([]);
      }
    })();
  }, [universeId]);

  const session = stories?.find((s) => s.id === storyId) ?? null;

  const sceneCharacters = session
    ? session.characterIds
        .map((id) => allCharacters.find((c) => c.id === id))
        .filter((c): c is Character => !!c)
    : [];

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }

  function toggleImport(id: string) {
    setImportIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }

  /** 체크한 캐릭터들의 1:1 대화를 요약해 하나의 맥락 블록으로 합친다 */
  async function buildCharacterContext(
    characters: Character[],
    resolvedUniverse: Universe
  ): Promise<string> {
    const parts: string[] = [];
    for (const c of characters) {
      if (!importIds.includes(c.id)) continue;
      const history = await getChatHistory(universeId, c.id).catch(() => []);
      if (history.length === 0) continue;
      try {
        const res = await fetch("/api/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            character: toCharacterProfile(c),
            characterId: c.id,
            universe: resolvedUniverse,
            history,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && typeof data.summary === "string" && data.summary.trim()) {
          parts.push(`- ${c.name}:\n${data.summary.trim()}`);
        }
      } catch {
        // 한 명 요약이 실패해도 나머지는 계속 시도한다
      }
    }
    return parts.join("\n\n");
  }

  async function requestEpisode(params: {
    characters: Character[];
    topic: string;
    previousEpisodes?: StoryEpisode[];
    characterContext?: string;
    directive?: string;
  }) {
    if (!universe) return null;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characters: params.characters.map(toCharacterProfile),
          universe: resolveUniverseTemplate(universe, allCharacters),
          topic: params.topic,
          previousEpisodes: params.previousEpisodes,
          characterContext: params.characterContext,
          directive: params.directive,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError({
          message: data.error ?? "이번 화를 만들지 못했어요.",
          kind: data.kind ?? "unknown",
        });
        return null;
      }
      return data.episode as StoryEpisode;
    } catch {
      setError({
        message: "네트워크 문제로 이번 화를 만들지 못했어요.",
        kind: "network",
      });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function handleStart() {
    if (selectedIds.length < 2 || !topic.trim() || !universe) return;
    const characters = allCharacters.filter((c) => selectedIds.includes(c.id));
    setLoading(true);
    const characterContext =
      importIds.length > 0
        ? await buildCharacterContext(
            characters,
            resolveUniverseTemplate(universe, allCharacters)
          )
        : "";
    setLoading(false);
    const episode = await requestEpisode({
      characters,
      topic: topic.trim(),
      characterContext,
    });
    if (!episode) return;
    const newStory: ObservationSession = {
      id: crypto.randomUUID(),
      universeId,
      characterIds: selectedIds,
      topic: topic.trim(),
      episodes: [episode],
      characterContext: characterContext || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setStories((prev) => [...(prev ?? []), newStory]);
    try {
      await saveStory(newStory);
    } catch {
      setError({ message: "이번 화를 저장하지 못했어요.", kind: "unknown" });
    }
    router.push(`/observe?universe=${universeId}&story=${newStory.id}`);
  }

  async function handleContinue() {
    if (!session) return;
    const episode = await requestEpisode({
      characters: sceneCharacters,
      topic: session.topic,
      previousEpisodes: session.episodes,
      characterContext: session.characterContext,
      directive: directive.trim() || undefined,
    });
    if (!episode) return;
    const updated: ObservationSession = {
      ...session,
      episodes: [...session.episodes, episode],
      updatedAt: Date.now(),
    };
    setStories((prev) =>
      (prev ?? []).map((s) => (s.id === updated.id ? updated : s))
    );
    setDirective("");
    try {
      await saveStory(updated);
    } catch {
      setError({ message: "이번 화를 저장하지 못했어요.", kind: "unknown" });
    }
  }

  async function handleDeleteStory(id: string) {
    if (!window.confirm("이 이야기를 삭제할까요? 되돌릴 수 없어요.")) return;
    setDeletingId(id);
    try {
      await deleteStory(universeId, id);
      setStories((prev) => (prev ?? []).filter((s) => s.id !== id));
      if (storyId === id) {
        router.push(`/observe?universe=${universeId}`);
      }
    } catch {
      setError({ message: "이야기를 지우지 못했어요.", kind: "unknown" });
    } finally {
      setDeletingId(null);
    }
  }

  /**
   * 지금까지 읽은 화들을 10줄 안팎으로 요약해 지문으로 미리 넣어둔
   * 새 멀티 대화방을 만든다. 기존 1:1 채팅방과 헷갈리지 않게 제목을
   * "상황 대화방"으로 고정한다.
   */
  async function handleStartSituationChat() {
    if (!session || !universe) return;
    setStartingChat(true);
    setStartChatError("");
    try {
      const res = await fetch("/api/summarize-story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characters: sceneCharacters.map(toCharacterProfile),
          universe: resolveUniverseTemplate(universe, allCharacters),
          episodes: session.episodes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.summary !== "string" || !data.summary.trim()) {
        setStartChatError(data.error ?? "상황을 요약하지 못했어요.");
        return;
      }

      const names = sceneCharacters.map((c) => c.name).join(" X ");
      const now = Date.now();
      const thread: Room = {
        id: crypto.randomUUID(),
        universeId,
        kind: "group",
        characterIds: session.characterIds,
        title: `상황 대화방 · ${names}`,
        items: [{ t: "n", text: data.summary.trim(), ts: now }],
        createdAt: now,
        updatedAt: now,
      };
      await saveRoom(thread);
      router.push(`/thread/${thread.id}?universe=${universeId}`);
    } catch {
      setStartChatError("네트워크 문제로 대화방을 만들지 못했어요.");
    } finally {
      setStartingChat(false);
    }
  }

  if (stories === null) return null;

  const isAu = universe && universe.type === "au";
  const showForm = showNewForm || stories.length === 0;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-4 pt-5 pb-3">
        <h1 className="text-xl font-bold">
          관찰 모드{isAu && <span className="text-muted"> · {universe.title}</span>}
        </h1>
        {session ? (
          <div className="flex items-center gap-1">
            <Link
              href={`/observe?universe=${universeId}`}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted"
            >
              ← 목록
            </Link>
            <button
              type="button"
              onClick={() => handleDeleteStory(session.id)}
              disabled={deletingId === session.id}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-40"
            >
              🗑 삭제
            </button>
          </div>
        ) : (
          !showForm &&
          stories.length > 0 && (
            <button
              type="button"
              onClick={() => setShowNewForm(true)}
              className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              + 새 이야기
            </button>
          )
        )}
      </header>

      <main className="mx-auto w-full max-w-[680px] flex-1 px-4 pb-4">
        {loadError && <p className="mb-3 text-sm text-red-600">{loadError}</p>}
        {!session ? (
          <div className="flex flex-col gap-5">
            {allCharacters.length < 2 ? (
              <p className="mt-8 text-center text-sm text-muted">
                관찰 모드를 쓰려면 캐릭터가 2명 이상 필요해요.
                <br />
                캐릭터 탭에서 먼저 캐릭터를 추가해 주세요.
              </p>
            ) : showForm ? (
              <>
                <div>
                  <p className="mb-2 text-sm font-medium">
                    등장할 캐릭터 (2명 이상)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {allCharacters.map((c) => {
                      const active = selectedIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleSelect(c.id)}
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

                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">주제</span>
                  <textarea
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="예: 고등학교 생활 / 비 오는 날 하교길에 마주쳤다"
                    rows={3}
                    className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
                  />
                </label>
                <p className="-mt-3 text-xs text-muted">
                  한 화당 5000자 안팎의 단편소설로 이어져요.
                </p>

                {selectedIds.some((id) => hasHistoryIds.has(id)) && (
                  <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3">
                    <p className="text-sm font-medium">이전 1:1 대화 가져오기</p>
                    <p className="text-xs text-muted">
                      체크하면 그 캐릭터와 나눈 1:1 대화를 요약해서 이야기
                      내내 캐릭터가 실제 말투·성격에서 벗어나지 않게 참고해요.
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {allCharacters
                        .filter(
                          (c) => selectedIds.includes(c.id) && hasHistoryIds.has(c.id)
                        )
                        .map((c) => (
                          <label key={c.id} className="flex items-center gap-2 text-sm">
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

                {error && (
                  <div className="flex flex-col items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <span>{error.message}</span>
                    <button
                      type="button"
                      onClick={handleStart}
                      className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium"
                    >
                      다시 시도
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleStart}
                  disabled={selectedIds.length < 2 || !topic.trim() || loading}
                  className="rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                >
                  {loading
                    ? importIds.length > 0
                      ? "이전 대화 요약하는 중…"
                      : "1화를 쓰는 중…"
                    : "이야기 시작"}
                </button>

                {stories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowNewForm(false)}
                    className="self-start text-xs text-muted underline"
                  >
                    ← 목록으로
                  </button>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-2">
                {stories
                  .slice()
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                  .map((s) => (
                    <div
                      key={s.id}
                      className="card-shadow flex items-center gap-3 rounded-2xl bg-card p-3"
                    >
                      <Link
                        href={`/observe?universe=${universeId}&story=${s.id}`}
                        className="min-w-0 flex-1"
                      >
                        <p className="truncate font-semibold">
                          {storyTitle(s, allCharacters)}
                        </p>
                        <p className="text-xs text-muted">
                          {s.episodes.length}화 · {formatDate(s.updatedAt)}
                        </p>
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDeleteStory(s.id)}
                        disabled={deletingId === s.id}
                        aria-label="이야기 삭제"
                        className="shrink-0 text-sm text-muted hover:text-red-600 disabled:opacity-40"
                      >
                        🗑
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted">주제: {session.topic}</p>
              <div className="flex flex-wrap gap-2">
                {sceneCharacters.map((c) => (
                  <span
                    key={c.id}
                    className="flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs"
                    style={{ borderColor: c.accentColor, color: c.accentColor }}
                  >
                    <CharacterAvatar character={c} size="sm" />
                    {c.name}
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={handleStartSituationChat}
                disabled={startingChat}
                className="self-start rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium disabled:opacity-40"
              >
                {startingChat ? "상황 요약하는 중…" : "💬 이 상황으로 대화 시작"}
              </button>
              {startChatError && (
                <p className="text-xs text-red-600">{startChatError}</p>
              )}
            </div>

            <div className="flex flex-col gap-8">
              {session.episodes.map((ep) => (
                <article key={ep.index} className="flex flex-col gap-3">
                  <h2 className="text-sm font-semibold text-muted">
                    {ep.index}화
                  </h2>
                  {ep.directive && (
                    <p className="text-xs italic text-muted">
                      🎬 지시: {ep.directive}
                    </p>
                  )}
                  <div className="flex flex-col gap-4">
                    {ep.text
                      .split(/\n+/)
                      .map((p) => p.trim())
                      .filter(Boolean)
                      .map((paragraph, i) => (
                        <p
                          key={i}
                          className="text-[15px] leading-[1.9] tracking-[0.01em] text-foreground"
                        >
                          {paragraph}
                        </p>
                      ))}
                  </div>
                </article>
              ))}
            </div>

            {loading && (
              <p className="text-center text-sm text-muted">
                다음 화를 쓰는 중…
              </p>
            )}

            {error && (
              <div className="flex flex-col items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <span>{error.message}</span>
                <button
                  type="button"
                  onClick={handleContinue}
                  className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium"
                >
                  다시 시도
                </button>
              </div>
            )}

            {!loading && (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted">
                    다음 화 지시 (선택)
                  </span>
                  <input
                    type="text"
                    value={directive}
                    onChange={(e) => setDirective(e.target.value)}
                    placeholder="예: 민준은 서연과 함께 도서관으로 이동한다"
                    className="rounded-xl border border-border bg-card p-2.5 text-sm outline-none focus:border-primary/50"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleContinue}
                  className="rounded-xl border border-border bg-card py-3 text-sm font-semibold"
                >
                  {session.episodes.length + 1}화 이어쓰기
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
