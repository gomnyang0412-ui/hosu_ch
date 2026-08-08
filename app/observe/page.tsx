"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import CharacterAvatar from "@/components/CharacterAvatar";
import {
  getCharacters,
  getObservationSession,
  getUniverse,
  saveObservationSession,
  clearObservationSession,
} from "@/lib/storage";
import { resolveUniverseTemplate } from "@/lib/template";
import {
  ACCENT_COLORS,
  ORG_UNIVERSE_ID,
  createOrgUniverse,
  toCharacterProfile,
  type Character,
  type ObservationSession,
  type SceneItem,
  type Universe,
} from "@/lib/types";

const MAX_CONTEXT_ITEMS = 30;

interface SceneErrorState {
  message: string;
  kind: "quota" | "network" | "unknown" | "parse";
}

function findCharacter(
  characters: Character[],
  name: string
): Pick<Character, "name" | "image" | "accentColor"> {
  const found = characters.find((c) => c.name === name);
  if (found) return found;
  return { name, image: undefined, accentColor: ACCENT_COLORS[0] };
}

export default function ObservePage() {
  return (
    <Suspense fallback={null}>
      <ObservePageInner />
    </Suspense>
  );
}

function ObservePageInner() {
  const searchParams = useSearchParams();
  const universeId = searchParams.get("universe") || ORG_UNIVERSE_ID;

  const [universe, setUniverse] = useState<Universe | null>(null);
  const [allCharacters, setAllCharacters] = useState<Character[]>([]);
  const [session, setSession] = useState<ObservationSession | null | undefined>(
    undefined
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SceneErrorState | null>(null);

  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setSession(undefined);
    setSelectedIds([]);
    setTopic("");
    setError(null);
    (async () => {
      try {
        const [characters, obsSession, foundUniverse] = await Promise.all([
          getCharacters(),
          getObservationSession(universeId),
          getUniverse(universeId).catch(() => undefined),
        ]);
        setAllCharacters(characters);
        setSession(obsSession);
        const resolvedFoundUniverse = foundUniverse ?? createOrgUniverse();
        setUniverse(resolvedFoundUniverse);
        if (
          !obsSession &&
          resolvedFoundUniverse.type === "au" &&
          resolvedFoundUniverse.roleA &&
          resolvedFoundUniverse.roleB
        ) {
          setSelectedIds([
            resolvedFoundUniverse.roleA,
            resolvedFoundUniverse.roleB,
          ]);
        }
      } catch {
        setLoadError("불러오지 못했어요. 새로고침해 주세요.");
        setSession(null);
      }
    })();
  }, [universeId]);

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

  async function requestScene(params: {
    characters: Character[];
    topic: string;
    previousItems?: SceneItem[];
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
          previousItems: params.previousItems?.slice(-MAX_CONTEXT_ITEMS),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError({
          message: data.error ?? "장면을 만들지 못했어요.",
          kind: data.kind ?? "unknown",
        });
        return null;
      }
      return data.items as SceneItem[];
    } catch {
      setError({
        message: "네트워크 문제로 장면을 만들지 못했어요.",
        kind: "network",
      });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function handleStart() {
    if (selectedIds.length < 2 || !topic.trim()) return;
    const characters = allCharacters.filter((c) => selectedIds.includes(c.id));
    const items = await requestScene({ characters, topic: topic.trim() });
    if (!items) return;
    const newSession: ObservationSession = {
      universeId,
      characterIds: selectedIds,
      topic: topic.trim(),
      items,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSession(newSession);
    try {
      await saveObservationSession(newSession);
    } catch {
      setError({ message: "장면을 저장하지 못했어요.", kind: "unknown" });
    }
  }

  async function handleContinue() {
    if (!session) return;
    const items = await requestScene({
      characters: sceneCharacters,
      topic: session.topic,
      previousItems: session.items,
    });
    if (!items) return;
    const updated: ObservationSession = {
      ...session,
      items: [...session.items, ...items],
      updatedAt: Date.now(),
    };
    setSession(updated);
    try {
      await saveObservationSession(updated);
    } catch {
      setError({ message: "장면을 저장하지 못했어요.", kind: "unknown" });
    }
  }

  async function handleRestart() {
    if (!window.confirm("지금 장면을 지우고 새로 시작할까요?")) return;
    try {
      await clearObservationSession(universeId);
    } catch {
      // 서버에서 못 지웠어도 화면은 새 설정 화면으로 돌아간다
    }
    setSession(null);
    setSelectedIds([]);
    setTopic("");
    setError(null);
  }

  if (session === undefined) return null;

  const isAu = universe && universe.type === "au";

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-4 pt-5 pb-3">
        <h1 className="text-xl font-bold">
          관찰 모드{isAu && <span className="text-muted"> · {universe.title}</span>}
        </h1>
        {session && (
          <button
            type="button"
            onClick={handleRestart}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted"
          >
            🔄 새로 시작
          </button>
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
            ) : (
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
                    className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-foreground/30"
                  />
                </label>

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
                  className="rounded-xl bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-40"
                >
                  {loading ? "장면을 만드는 중…" : "장면 시작"}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <p className="text-xs text-muted">주제: {session.topic}</p>

            <div className="flex flex-col gap-4">
              {session.items.map((item, i) =>
                item.t === "n" ? (
                  <p
                    key={i}
                    className="border-l-2 border-border pl-3 text-[13px] italic leading-relaxed text-muted"
                  >
                    {item.text}
                  </p>
                ) : (
                  <div key={i} className="flex flex-col gap-1">
                    {(() => {
                      const c = findCharacter(sceneCharacters, item.who);
                      return (
                        <>
                          <div className="flex items-center gap-2">
                            <CharacterAvatar character={c} size="sm" />
                            <span
                              className="text-sm font-semibold"
                              style={{ color: c.accentColor }}
                            >
                              {item.who}
                            </span>
                          </div>
                          {item.act && (
                            <p className="pl-9 text-[13px] italic text-muted">
                              {item.act}
                            </p>
                          )}
                          <p className="pl-9 text-[15px] leading-relaxed">
                            {item.say}
                          </p>
                        </>
                      );
                    })()}
                  </div>
                )
              )}
            </div>

            {loading && (
              <p className="text-center text-sm text-muted">
                다음 장면을 만드는 중…
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
              <button
                type="button"
                onClick={handleContinue}
                className="rounded-xl border border-border bg-card py-3 text-sm font-semibold"
              >
                더 이어보기
              </button>
            )}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
