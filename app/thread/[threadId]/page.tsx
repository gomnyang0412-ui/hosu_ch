"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import AutoGrowTextarea from "@/components/AutoGrowTextarea";
import CharacterAvatar from "@/components/CharacterAvatar";
import ChatListPane from "@/components/ChatListPane";
import TopBar from "@/components/TopBar";
import DialogueBubble from "@/components/chat/DialogueBubble";
import ErrorRetryBanner from "@/components/chat/ErrorRetryBanner";
import NarrationBubble from "@/components/chat/NarrationBubble";
import { useKeyboardScrollFix } from "@/hooks/useKeyboardScrollFix";
import {
  deleteRoom,
  getCharacters,
  getRoom,
  getUniverse,
  saveRoom,
  StorageError,
} from "@/lib/storage";
import { resolveUniverseTemplate } from "@/lib/template";
import {
  ACCENT_COLORS,
  ORG_UNIVERSE_ID,
  createOrgUniverse,
  toCharacterProfile,
  type Character,
  type Room,
  type RoomItem,
  type ThreadItem,
  type Universe,
} from "@/lib/types";

interface ThreadErrorState {
  message: string;
  kind: "quota" | "network" | "overloaded" | "unknown" | "parse";
}

function findParticipant(
  participants: Character[],
  name: string
): Pick<Character, "name" | "image" | "accentColor"> {
  const found = participants.find((c) => c.name === name);
  if (found) return found;
  return { name, image: undefined, accentColor: ACCENT_COLORS[0] };
}

/** "나"로 고를 수 있는 값. 빈 문자열 = 이름 없는 참가자(기본) */
const NO_PLAYER = "";

function initialTargetId(items: RoomItem[], participants: Character[]): string {
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

  const [thread, setThread] = useState<Room | null>(null);
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
  const [pickingPlayer, setPickingPlayer] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const { bottomRef, handleInputFocus } = useKeyboardScrollFix([
    thread?.items.length,
    loading,
  ]);
  const lastTargetIdRef = useRef("");

  useEffect(() => {
    (async () => {
      try {
        const [foundThread, characters, foundUniverse] = await Promise.all([
          getRoom(universeId, threadId),
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
        const aiParticipants = participants.filter(
          (c) => c.id !== foundThread.playerCharacterId
        );
        setTargetId(initialTargetId(foundThread.items, aiParticipants));
      } catch {
        setLoadError("대화방을 불러오지 못했어요. 새로고침해 주세요.");
      }
    })();
  }, [threadId, universeId, router]);

  const participants = thread
    ? thread.characterIds
        .map((id) => allCharacters.find((c) => c.id === id))
        .filter((c): c is Character => !!c)
    : [];
  const playerCharacter = participants.find(
    (c) => c.id === thread?.playerCharacterId
  );
  const aiParticipants = participants.filter(
    (c) => c.id !== thread?.playerCharacterId
  );

  async function requestReply(base: Room, targetChar: Character) {
    if (!universe) return;
    setLoading(true);
    setError(null);
    lastTargetIdRef.current = targetChar.id;
    try {
      const res = await fetch("/api/room-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiCharacters: aiParticipants.map(toCharacterProfile),
          universe: resolveUniverseTemplate(universe, allCharacters),
          targetName: targetChar.name,
          targetId: targetChar.id,
          playerCharacter: playerCharacter
            ? toCharacterProfile(playerCharacter)
            : undefined,
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
      const newItems: RoomItem[] = (data.items as ThreadItem[]).map((it) => ({
        ...it,
        ts: now,
      }));
      const updated: Room = {
        ...base,
        items: [...base.items, ...newItems],
        updatedAt: now,
      };
      setThread(updated);
      try {
        await saveRoom(updated);
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
    const targetChar = aiParticipants.find((c) => c.id === targetId);
    if (!text || !thread || !targetChar || loading) return;
    const now = Date.now();
    const item: RoomItem = { t: "u", text, ts: now };
    const updated: Room = {
      ...thread,
      items: [...thread.items, item],
      updatedAt: now,
    };
    setThread(updated);
    setInput("");
    try {
      await saveRoom(updated);
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
    const targetChar = aiParticipants.find((c) => c.id === targetId);
    if (!text || !thread || !targetChar || loading) return;
    const now = Date.now();
    const item: RoomItem = { t: "x", text, ts: now };
    const updated: Room = {
      ...thread,
      items: [...thread.items, item],
      updatedAt: now,
    };
    setThread(updated);
    setDirectiveText("");
    setShowDirective(false);
    try {
      await saveRoom(updated);
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
    const targetChar = aiParticipants.find((c) => c.id === lastTargetIdRef.current);
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
    const now = Date.now();
    const editedItem: RoomItem = { t: original.t, text, ts: now };
    const updated: Room = {
      ...thread,
      items: [...thread.items.slice(0, editingIndex), editedItem],
      updatedAt: now,
    };
    setThread(updated);
    setEditingIndex(null);
    setEditingText("");
    try {
      await saveRoom(updated);
    } catch (err) {
      setError({
        message:
          err instanceof StorageError
            ? err.message
            : "대화를 저장하지 못했어요.",
        kind: "unknown",
      });
    }
    const targetChar = aiParticipants.find((c) => c.id === targetId);
    if (targetChar) requestReply(updated, targetChar);
  }

  async function choosePlayerCharacter(nextId: string) {
    if (!thread) return;
    const nextPlayerId = nextId || undefined;
    if (nextPlayerId === thread.playerCharacterId) return;
    const updated: Room = {
      ...thread,
      playerCharacterId: nextPlayerId,
      updatedAt: Date.now(),
    };
    setThread(updated);
    // 방금 나로 고른 캐릭터가 지금 말 걸던 대상이었다면, 대상을 남은
    // AI 참가자 중 하나로 다시 잡아준다.
    if (targetId === nextPlayerId) {
      const fallback = participants.find((c) => c.id !== nextPlayerId);
      setTargetId(fallback?.id ?? "");
    }
    try {
      await saveRoom(updated);
    } catch (err) {
      setError({
        message:
          err instanceof StorageError
            ? err.message
            : "역할 설정을 저장하지 못했어요.",
        kind: "unknown",
      });
    }
  }

  async function handleLeaveRoom() {
    if (!thread || leaving) return;
    if (!window.confirm("이 대화방을 나갈까요? 지금까지의 대화 기록이 모두 사라져요.")) {
      return;
    }
    setLeaving(true);
    try {
      await deleteRoom(universeId, thread.id);
      router.replace("/chats");
    } catch (err) {
      setError({
        message:
          err instanceof StorageError
            ? err.message
            : "대화방을 나가지 못했어요.",
        kind: "unknown",
      });
      setLeaving(false);
    }
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

  const roomHref = `/thread/${threadId}?universe=${universeId}`;

  return (
    <div className="flex flex-1 lg:gap-6">
      <aside className="hidden w-72 shrink-0 lg:sticky lg:top-6 lg:block lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
        <ChatListPane activeHref={roomHref} />
      </aside>
      <div className="relative flex flex-1 flex-col">
      <TopBar
        title={title || "대화방"}
        right={
          <div className="flex items-center gap-1">
            {participants.length >= 2 && (
              <button
                type="button"
                onClick={() => setPickingPlayer((v) => !v)}
                aria-label="나 역할 정하기"
                className="rounded-full px-2.5 py-1 text-xs font-medium text-muted hover:bg-background"
              >
                🙋 나: {playerCharacter?.name ?? "없음"}
              </button>
            )}
            <button
              type="button"
              onClick={handleLeaveRoom}
              disabled={leaving}
              aria-label="대화방 나가기"
              className="rounded-full px-2.5 py-1 text-xs font-medium text-muted hover:bg-background disabled:opacity-40"
            >
              🚪 나가기
            </button>
          </div>
        }
      />

      {pickingPlayer && (
        <div className="flex flex-col gap-2 border-b border-border bg-card px-3 py-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            나는
            <select
              value={thread.playerCharacterId ?? NO_PLAYER}
              onChange={(e) => choosePlayerCharacter(e.target.value)}
              className="rounded-xl border border-border bg-background p-2 text-sm text-foreground outline-none focus:border-primary/50"
            >
              <option value={NO_PLAYER}>이름 없는 참가자 (기본)</option>
              {participants.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted">
            고른 캐릭터는 AI가 더는 연기하지 않고, 다른 인물들이 그
            배경·관계를 알고 있는 사람으로 나를 대해요.
          </p>
          <button
            type="button"
            onClick={() => setPickingPlayer(false)}
            className="self-end rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted"
          >
            닫기
          </button>
        </div>
      )}

      <main className="flex flex-1 flex-col gap-3 px-3 py-4">
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}
        {participants.length < 2 ? (
          <p className="text-sm text-muted">
            참가자가 부족해요. 캐릭터가 삭제되었을 수 있어요.
          </p>
        ) : (
          aiParticipants.length === 0 && (
            <p className="text-sm text-muted">
              지금은 대화 상대가 없어요. "나" 설정을 해제하거나 캐릭터를
              추가해 주세요.
            </p>
          )
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
                  className="w-full max-w-[75%] resize-none rounded-3xl border border-foreground/30 bg-background px-3 py-2 text-sm leading-relaxed outline-none md:max-w-[420px]"
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
                    className="gradient-primary rounded-full px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40"
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
                <div className="gradient-primary max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-br-sm px-3 py-2 text-sm leading-relaxed text-primary-foreground md:max-w-[420px]">
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
            return <NarrationBubble key={i} text={item.text} />;
          }
          const c = findParticipant(participants, item.who);
          return (
            <DialogueBubble
              key={i}
              speaker={c}
              act={item.act}
              say={item.say}
              model={item.model}
              keyIndex={item.keyIndex}
              showName
            />
          );
        })}

        {loading && (
          <p className="text-center text-sm text-muted">입력 중…</p>
        )}

        {error && (
          <ErrorRetryBanner message={error.message} onRetry={handleRetry} />
        )}

        {/*
          입력창을 fixed나 sticky로 화면에 띄우려면 결국 "키보드가 얼마나
          가리는지"를 알아야 하는데, 이 기기·브라우저에서는 그걸 알아낼
          방법이 없었다(1:1 채팅방과 같은 문제). 그래서 입력창을 아무 위치
          지정 없이 대화 목록의 마지막 항목으로 그냥 둔다 — 페이지 자체의
          기본 스크롤에 맡기면, 페이지가 얼마나 긴지와 무관하게 끝까지
          스크롤했을 때 항상 화면에 나타난다.
        */}
        <div className="-mx-3 flex flex-col gap-2 border-t border-border bg-card px-3 py-2">
          {aiParticipants.length >= 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {aiParticipants.map((c) => {
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
          {showDirective && (
            <div className="flex items-end gap-2">
              <AutoGrowTextarea
                value={directiveText}
                onChange={setDirectiveText}
                onFocus={handleInputFocus}
                placeholder="예: 몇 시간 후, 미하일을 만난다"
                maxHeightPx={96}
                className="flex-1 resize-none rounded-3xl border border-dashed border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
              <button
                type="button"
                onClick={handleDirectiveSubmit}
                disabled={loading || !directiveText.trim()}
                className="shrink-0 rounded-full border border-border px-3 py-2 text-sm font-medium disabled:opacity-40"
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
            <AutoGrowTextarea
              value={input}
              onChange={setInput}
              onFocus={handleInputFocus}
              placeholder={
                aiParticipants.find((c) => c.id === targetId)
                  ? `${aiParticipants.find((c) => c.id === targetId)?.name}에게 말하기`
                  : "메시지를 입력하세요"
              }
              enterKeyHint="enter"
              className="flex-1 resize-none rounded-3xl border border-border bg-background px-4 py-2 text-sm outline-none focus:border-primary/50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={loading || !input.trim() || aiParticipants.length === 0}
              className="gradient-primary shrink-0 rounded-full px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >
              전송
            </button>
          </div>
        </div>

        <div ref={bottomRef} />
      </main>
      </div>
    </div>
  );
}
