"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import CharacterAvatar from "@/components/CharacterAvatar";
import TopBar from "@/components/TopBar";
import {
  getCharacters,
  getThread,
  getUniverse,
  saveThread,
  StorageError,
} from "@/lib/storage";
import { resolveUniverseTemplate } from "@/lib/template";
import {
  ACCENT_COLORS,
  ORG_UNIVERSE_ID,
  createOrgUniverse,
  toCharacterProfile,
  type Character,
  type MultiThread,
  type ThreadItem,
  type Universe,
} from "@/lib/types";

interface ThreadErrorState {
  message: string;
  kind: "quota" | "network" | "unknown" | "parse";
}

function findParticipant(
  participants: Character[],
  name: string
): Pick<Character, "name" | "image" | "accentColor"> {
  const found = participants.find((c) => c.name === name);
  if (found) return found;
  return { name, image: undefined, accentColor: ACCENT_COLORS[0] };
}

function initialTargetId(items: ThreadItem[], participants: Character[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.t === "d") {
      const found = participants.find((c) => c.name === item.who);
      if (found) return found.id;
    }
  }
  return participants[0]?.id ?? "";
}

export default function ThreadPage() {
  return (
    <Suspense fallback={null}>
      <ThreadPageInner />
    </Suspense>
  );
}

function ThreadPageInner() {
  const { threadId } = useParams<{ threadId: string }>();
  const searchParams = useSearchParams();
  const universeId = searchParams.get("universe") || ORG_UNIVERSE_ID;
  const router = useRouter();

  const [thread, setThread] = useState<MultiThread | null>(null);
  const [universe, setUniverse] = useState<Universe | null>(null);
  const [allCharacters, setAllCharacters] = useState<Character[]>([]);
  const [targetId, setTargetId] = useState("");
  const [input, setInput] = useState("");
  const [showDirective, setShowDirective] = useState(false);
  const [directiveText, setDirectiveText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ThreadErrorState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastTargetIdRef = useRef("");

  useEffect(() => {
    (async () => {
      try {
        const [foundThread, characters, foundUniverse] = await Promise.all([
          getThread(universeId, threadId),
          getCharacters(),
          getUniverse(universeId).catch(() => undefined),
        ]);
        if (!foundThread) {
          router.replace(`/au`);
          return;
        }
        setThread(foundThread);
        setAllCharacters(characters);
        setUniverse(foundUniverse ?? createOrgUniverse());
        const participants = foundThread.characterIds
          .map((id) => characters.find((c) => c.id === id))
          .filter((c): c is Character => !!c);
        setTargetId(initialTargetId(foundThread.items, participants));
      } catch {
        setLoadError("대화방을 불러오지 못했어요. 새로고침해 주세요.");
      }
    })();
  }, [threadId, universeId, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.items.length, loading]);

  const participants = thread
    ? thread.characterIds
        .map((id) => allCharacters.find((c) => c.id === id))
        .filter((c): c is Character => !!c)
    : [];

  async function requestReply(base: MultiThread, targetChar: Character) {
    if (!universe) return;
    setLoading(true);
    setError(null);
    lastTargetIdRef.current = targetChar.id;
    try {
      const res = await fetch("/api/thread-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characters: participants.map(toCharacterProfile),
          universe: resolveUniverseTemplate(universe, allCharacters),
          targetName: targetChar.name,
          targetId: targetChar.id,
          items: base.items,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError({
          message: data.error ?? "메시지를 보내지 못했어요.",
          kind: data.kind ?? "unknown",
        });
        return;
      }
      const now = Date.now();
      const updated: MultiThread = {
        ...base,
        items: [...base.items, ...(data.items as ThreadItem[])],
        updatedAt: now,
      };
      setThread(updated);
      try {
        await saveThread(updated);
      } catch (err) {
        setError({
          message:
            err instanceof StorageError
              ? err.message
              : "대화를 저장하지 못했어요.",
          kind: "unknown",
        });
      }
    } catch {
      setError({
        message: "네트워크 문제로 메시지를 보내지 못했어요.",
        kind: "network",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    const text = input.trim();
    const targetChar = participants.find((c) => c.id === targetId);
    if (!text || !thread || !targetChar || loading) return;
    const item: ThreadItem = { t: "u", text };
    const now = Date.now();
    const updated: MultiThread = {
      ...thread,
      items: [...thread.items, item],
      updatedAt: now,
    };
    setThread(updated);
    setInput("");
    try {
      await saveThread(updated);
    } catch (err) {
      setError({
        message:
          err instanceof StorageError
            ? err.message
            : "대화를 저장하지 못했어요.",
        kind: "unknown",
      });
    }
    requestReply(updated, targetChar);
  }

  async function handleDirectiveSubmit() {
    const text = directiveText.trim();
    const targetChar = participants.find((c) => c.id === targetId);
    if (!text || !thread || !targetChar || loading) return;
    const item: ThreadItem = { t: "x", text };
    const now = Date.now();
    const updated: MultiThread = {
      ...thread,
      items: [...thread.items, item],
      updatedAt: now,
    };
    setThread(updated);
    setDirectiveText("");
    setShowDirective(false);
    try {
      await saveThread(updated);
    } catch (err) {
      setError({
        message:
          err instanceof StorageError
            ? err.message
            : "대화를 저장하지 못했어요.",
        kind: "unknown",
      });
    }
    requestReply(updated, targetChar);
  }

  function handleRetry() {
    const targetChar = participants.find((c) => c.id === lastTargetIdRef.current);
    if (!thread || !targetChar) return;
    requestReply(thread, targetChar);
  }

  function startEdit(i: number) {
    if (loading || !thread) return;
    const item = thread.items[i];
    if (item.t !== "u" && item.t !== "x") return;
    setEditingIndex(i);
    setEditingText(item.text);
  }

  function cancelEdit() {
    setEditingIndex(null);
    setEditingText("");
  }

  async function submitEdit() {
    const text = editingText.trim();
    if (!text || editingIndex === null || !thread) return;
    const original = thread.items[editingIndex];
    if (original.t !== "u" && original.t !== "x") return;
    const editedItem: ThreadItem = { t: original.t, text };
    const now = Date.now();
    const updated: MultiThread = {
      ...thread,
      items: [...thread.items.slice(0, editingIndex), editedItem],
      updatedAt: now,
    };
    setThread(updated);
    setEditingIndex(null);
    setEditingText("");
    try {
      await saveThread(updated);
    } catch (err) {
      setError({
        message:
          err instanceof StorageError
            ? err.message
            : "대화를 저장하지 못했어요.",
        kind: "unknown",
      });
    }
    const targetChar = participants.find((c) => c.id === targetId);
    if (targetChar) requestReply(updated, targetChar);
  }

  if (!thread) {
    return loadError ? (
      <p className="p-4 text-sm text-red-600">{loadError}</p>
    ) : null;
  }

  const isAu = universe && universe.type === "au";
  const title =
    (thread.title?.trim() || participants.map((c) => c.name).join(" · ")) +
    (isAu ? ` · ${universe.title}` : "");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title={title || "대화방"} />

      {participants.length >= 2 && (
        <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-border bg-card px-3 py-2">
          {participants.map((c) => {
            const active = targetId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setTargetId(c.id)}
                className="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-sm transition-colors"
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
      )}

      <main className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-4">
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}
        {participants.length < 2 && (
          <p className="text-sm text-muted">
            참가자가 부족해요. 캐릭터가 삭제되었을 수 있어요.
          </p>
        )}

        {thread.items.map((item, i) => {
          if (editingIndex === i && (item.t === "u" || item.t === "x")) {
            return (
              <div key={i} className="flex flex-col items-end gap-1.5">
                <textarea
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  autoFocus
                  rows={item.t === "x" ? 1 : 2}
                  className="w-full max-w-[75%] resize-none rounded-2xl border border-foreground/30 bg-background px-3 py-2 text-sm leading-relaxed outline-none md:max-w-[420px]"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={submitEdit}
                    disabled={!editingText.trim()}
                    className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                  >
                    수정하고 다시 받기
                  </button>
                </div>
              </div>
            );
          }
          if (item.t === "u") {
            return (
              <div key={i} className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => startEdit(i)}
                  disabled={loading}
                  aria-label="메시지 수정"
                  className="shrink-0 text-xs text-muted hover:text-foreground disabled:opacity-40"
                >
                  ✎
                </button>
                <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground md:max-w-[420px]">
                  {item.text}
                </div>
              </div>
            );
          }
          if (item.t === "x") {
            return (
              <div
                key={i}
                className="flex items-center gap-2 py-1 text-center text-xs text-muted"
              >
                <span className="h-px flex-1 bg-border" />
                <button
                  type="button"
                  onClick={() => startEdit(i)}
                  disabled={loading}
                  aria-label="지시문 수정"
                  className="shrink-0 hover:text-foreground disabled:opacity-40"
                >
                  ✎
                </button>
                <span>🎬 {item.text}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            );
          }
          if (item.t === "n") {
            return (
              <p
                key={i}
                className="border-l-2 border-border pl-3 text-[13px] italic leading-relaxed text-muted"
              >
                {item.text}
              </p>
            );
          }
          const c = findParticipant(participants, item.who);
          return (
            <div key={i} className="flex items-end gap-2">
              <CharacterAvatar character={c} size="sm" />
              <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm leading-relaxed md:max-w-[420px]">
                <p
                  className="mb-0.5 text-xs font-semibold"
                  style={{ color: c.accentColor }}
                >
                  {item.who}
                </p>
                {item.act && (
                  <p className="mb-1 text-xs italic text-muted">{item.act}</p>
                )}
                {item.say}
              </div>
            </div>
          );
        })}

        {loading && (
          <p className="text-center text-sm text-muted">입력 중…</p>
        )}

        {error && (
          <div className="flex flex-col items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>{error.message}</span>
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium"
            >
              다시 시도
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <footer className="sticky bottom-0 flex flex-col gap-2 border-t border-border bg-card px-3 py-2">
        {showDirective && (
          <div className="flex items-end gap-2">
            <textarea
              value={directiveText}
              onChange={(e) => setDirectiveText(e.target.value)}
              placeholder="예: 몇 시간 후, 미하일을 만난다"
              rows={1}
              className="max-h-24 flex-1 resize-none rounded-xl border border-dashed border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
            <button
              type="button"
              onClick={handleDirectiveSubmit}
              disabled={loading || !directiveText.trim()}
              className="shrink-0 rounded-xl border border-border px-3 py-2 text-sm font-medium disabled:opacity-40"
            >
              적용
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => setShowDirective((v) => !v)}
            aria-label="상황 전환"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm ${
              showDirective
                ? "border-foreground text-foreground"
                : "border-border text-muted"
            }`}
          >
            🎬
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              participants.find((c) => c.id === targetId)
                ? `${participants.find((c) => c.id === targetId)?.name}에게 말하기`
                : "메시지를 입력하세요"
            }
            rows={1}
            className="max-h-32 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={loading || !input.trim() || participants.length < 2}
            className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            전송
          </button>
        </div>
      </footer>
    </div>
  );
}
