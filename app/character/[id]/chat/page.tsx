"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import AutoGrowTextarea from "@/components/AutoGrowTextarea";
import CharacterAvatar from "@/components/CharacterAvatar";
import ChatListPane from "@/components/ChatListPane";
import TopBar from "@/components/TopBar";
import { CameraIcon, ChevronRightIcon, EditIcon, MenuIcon } from "@/components/icons";
import BackupPanel from "@/components/chat/BackupPanel";
import ChatMenu from "@/components/chat/ChatMenu";
import DialogueBubble from "@/components/chat/DialogueBubble";
import ErrorRetryBanner from "@/components/chat/ErrorRetryBanner";
import NarrationBubble from "@/components/chat/NarrationBubble";
import RenamePanel from "@/components/chat/RenamePanel";
import RolePickerPanel from "@/components/chat/RolePickerPanel";
import TimelinePanel from "@/components/chat/TimelinePanel";
import {
  dateAnchorId,
  formatDateLabel,
  groupMessagesByDate,
} from "@/lib/chatDates";
import { kstDateString, todayKST } from "@/lib/memory";
import { useConversationSplit } from "@/hooks/useConversationSplit";
import { useImageAttachment } from "@/hooks/useImageAttachment";
import { useKeyboardScrollFix } from "@/hooks/useKeyboardScrollFix";
import { useRoomBackups } from "@/hooks/useRoomBackups";
import { roomItemsToChatMessages } from "@/lib/roomBridge";
import {
  getCharacter,
  getCharacters,
  getRoomForCharacter,
  getUniverse,
  saveCharacter,
  saveRoom,
  StorageError,
} from "@/lib/storage";
import {
  PLAYER_ANONYMOUS,
  resolveActivePlayerCharacter,
  resolveActiveVoiceCharacter,
  resolveVoiceCharacter,
} from "@/lib/character";
import { resolveUniverseTemplate } from "@/lib/template";
import {
  IMAGE_RETENTION_MS,
  ORG_UNIVERSE_ID,
  createOrgUniverse,
  toCharacterProfile,
  type Character,
  type Room,
  type RoomItem,
  type ThreadItem,
  type Universe,
} from "@/lib/types";

interface ChatErrorState {
  message: string;
  kind: "quota" | "network" | "overloaded" | "unknown" | "parse";
}

function singleRoomId(characterId: string) {
  return `single-${characterId}`;
}

/** 화면 렌더링·수정·나누기 기준 단위. 사용자 발화 1건은 항상 혼자,
 *  AI 한 턴(지문+대사 여러 개)은 같은 ts를 공유하는 것끼리 묶는다. */
function groupByTurn(
  items: RoomItem[]
): { startIndex: number; items: RoomItem[] }[] {
  const turns: { startIndex: number; items: RoomItem[] }[] = [];
  items.forEach((item, i) => {
    const last = turns[turns.length - 1];
    if (
      last &&
      item.t !== "u" &&
      last.items[0].t !== "u" &&
      last.items[0].ts === item.ts
    ) {
      last.items.push(item);
    } else {
      turns.push({ startIndex: i, items: [item] });
    }
  });
  return turns;
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const universeId = searchParams.get("universe") || ORG_UNIVERSE_ID;
  const router = useRouter();

  const [character, setCharacter] = useState<Character | null>(null);
  const [universe, setUniverse] = useState<Universe | null>(null);
  const [allCharacters, setAllCharacters] = useState<Character[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [loadError, setLoadError] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ChatErrorState | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickingVoice, setPickingVoice] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const { bottomRef, handleInputFocus } = useKeyboardScrollFix([
    room?.items.length,
    loading,
  ]);
  const {
    pendingImage,
    pendingImageLoading,
    handleAttachImage,
    clearPendingImage,
  } = useImageAttachment((message) => setError({ message, kind: "unknown" }));
  const { backups, restoring, openBackups, restoreBackup, closeBackups } =
    useRoomBackups(universeId, singleRoomId(id), {
      onRestored: setRoom,
      clearError: () => setError(null),
      onError: (message) => setError({ message, kind: "unknown" }),
    });
  const {
    splitMode,
    splitIndex,
    splitTargetId,
    splitting,
    splitDone,
    setSplitTargetId,
    toggleSplitMode,
    pickSplitPoint,
    cancelSplitPoint,
    confirmSplit,
  } = useConversationSplit(universeId, room, allCharacters, singleRoomId, {
    onSplit: setRoom,
    clearError: () => setError(null),
    onError: (message) => setError({ message, kind: "unknown" }),
  });

  useEffect(() => {
    (async () => {
      const found = await getCharacter(id).catch(() => undefined);
      if (!found) {
        router.replace("/");
        return;
      }
      setCharacter(found);

      const foundUniverse = await getUniverse(universeId).catch(
        () => undefined
      );
      setUniverse(foundUniverse ?? createOrgUniverse());

      const characters = await getCharacters().catch(() => []);
      setAllCharacters(characters);
      const voiceCharacter = resolveVoiceCharacter(found, characters);

      try {
        const existingRoom = await getRoomForCharacter(universeId, id);
        if (!existingRoom || existingRoom.items.length === 0) {
          const firstText = voiceCharacter.firstMessage.trim();
          const now = Date.now();
          const seededItems: RoomItem[] = firstText
            ? [{ t: "d", who: voiceCharacter.name, say: firstText, ts: now }]
            : [];
          const seededRoom: Room = existingRoom
            ? { ...existingRoom, items: seededItems, updatedAt: now }
            : {
                id: singleRoomId(id),
                universeId,
                kind: "single",
                characterIds: [id],
                items: seededItems,
                createdAt: now,
                updatedAt: now,
              };
          setRoom(seededRoom);
          if (seededItems.length > 0) {
            try {
              await saveRoom(seededRoom);
            } catch {
              // 저장 실패해도 화면에는 첫 인사를 보여준다
            }
          }
        } else {
          setRoom(existingRoom);
          // 날짜가 넘어간(KST 자정 기준) 뒤 이 방에 처음 들어온 거라면,
          // 지금까지의 대화를 "가져오기"와 같은 방식(최근 100개 상세 +
          // 그 이전 기억 한 줄씩)으로 자동 요약해서 지문으로 남겨둔다.
          // 단, 마지막 항목이 이미 그 자동 요약이라면 그 뒤로 새 대화가
          // 하나도 없었다는 뜻이니 또 끼워 넣지 않는다 — 안 그러면 며칠씩
          // 대화가 없어도 들어갈 때마다 요약이 계속 쌓여서 창이 지저분해진다.
          const lastItem = existingRoom.items[existingRoom.items.length - 1];
          if (
            lastItem &&
            !(lastItem.t === "n" && lastItem.isRecap) &&
            kstDateString(lastItem.ts) !== todayKST()
          ) {
            try {
              const res = await fetch("/api/summarize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  character: toCharacterProfile(voiceCharacter),
                  characterId: voiceCharacter.id,
                  universe: resolveUniverseTemplate(
                    foundUniverse ?? createOrgUniverse(),
                    characters
                  ),
                  history: roomItemsToChatMessages(existingRoom.items),
                }),
              });
              const data = await res.json().catch(() => ({}));
              if (res.ok && typeof data.summary === "string" && data.summary.trim()) {
                const recapText = data.summary.trim();
                const now = Date.now();
                const withRecap: Room = {
                  ...existingRoom,
                  items: [
                    ...existingRoom.items,
                    { t: "n", text: recapText, ts: now, isRecap: true },
                  ],
                  updatedAt: now,
                };
                setRoom(withRecap);
                await saveRoom(withRecap).catch(() => {});
              }
            } catch {
              // 자동 요약은 부가 기능이라 실패해도 방 진입 자체는 막지 않는다
            }
          }
        }
      } catch {
        setLoadError("대화 기록을 불러오지 못했어요. 새로고침해 주세요.");
      }
    })();
  }, [id, universeId, router]);

  async function sendToAI(chatCharacter: Character, chatUniverse: Universe, baseRoom: Room) {
    setLoading(true);
    setError(null);
    const voiceCharacter = resolveActiveVoiceCharacter(
      chatCharacter,
      allCharacters,
      baseRoom.aiVoiceOverrideId ?? null
    );
    const activePlayerCharacter = resolveActivePlayerCharacter(
      chatCharacter,
      allCharacters,
      voiceCharacter,
      baseRoom.playerCharacterId ?? null
    );
    try {
      const res = await fetch("/api/room-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiCharacters: [toCharacterProfile(voiceCharacter)],
          universe: chatUniverse,
          targetName: voiceCharacter.name,
          targetId: voiceCharacter.id,
          items: baseRoom.items,
          playerCharacter: activePlayerCharacter
            ? toCharacterProfile(activePlayerCharacter)
            : undefined,
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
      const newItems: RoomItem[] = (data.items as ThreadItem[])
        .filter((it) => it.t === "n" || it.t === "d")
        .map((it) => ({ ...it, ts: now }));
      const next: Room = {
        ...baseRoom,
        items: [...baseRoom.items, ...newItems],
        updatedAt: now,
      };
      setRoom(next);
      try {
        await saveRoom(next);
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
    if ((!text && !pendingImage) || !character || !universe || !room || loading) return;
    const now = Date.now();
    const newItem: RoomItem = {
      t: "u",
      text,
      ts: now,
      ...(pendingImage
        ? { image: pendingImage, imageExpiresAt: now + IMAGE_RETENTION_MS }
        : {}),
    };
    const next: Room = {
      ...room,
      items: [...room.items, newItem],
      updatedAt: now,
    };
    setRoom(next);
    setInput("");
    clearPendingImage();
    try {
      await saveRoom(next);
    } catch (err) {
      setError({
        message:
          err instanceof StorageError
            ? err.message
            : "대화를 저장하지 못했어요.",
        kind: "unknown",
      });
    }
    sendToAI(character, resolveUniverseTemplate(universe, allCharacters), next);
  }

  function handleRetry() {
    if (!character || !universe || !room) return;
    sendToAI(character, resolveUniverseTemplate(universe, allCharacters), room);
  }

  // isRecap 표시가 있는 것만이 아니라 지문(NarrationItem) 전체를 지울 수
  // 있게 한다 — isRecap 필드가 생기기 전에 쌓인 예전 자동 요약들은 이
  // 표시가 없어서, isRecap만으로 걸러내면 그 예전 것들은 지울 방법이
  // 없기 때문이다(요약이든 일반 지문이든 사용자가 직접 판단해서 지운다).
  async function handleDeleteNarration(i: number) {
    if (!room) return;
    const item = room.items[i];
    if (item.t !== "n") return;
    const next: Room = {
      ...room,
      items: [...room.items.slice(0, i), ...room.items.slice(i + 1)],
      updatedAt: Date.now(),
    };
    setRoom(next);
    try {
      await saveRoom(next);
    } catch (err) {
      setError({
        message: err instanceof StorageError ? err.message : "지우지 못했어요.",
        kind: "unknown",
      });
    }
  }

  function startEdit(i: number) {
    if (loading || !room) return;
    const item = room.items[i];
    if (item.t !== "u") return;
    setEditingIndex(i);
    setEditingText(item.text);
  }

  function cancelEdit() {
    setEditingIndex(null);
    setEditingText("");
  }

  async function submitEdit() {
    const text = editingText.trim();
    if (!text || editingIndex === null || !character || !universe || !room) return;
    const now = Date.now();
    const next: Room = {
      ...room,
      items: [...room.items.slice(0, editingIndex), { t: "u", text, ts: now }],
      updatedAt: now,
    };
    setRoom(next);
    setEditingIndex(null);
    setEditingText("");
    try {
      await saveRoom(next);
    } catch (err) {
      setError({
        message:
          err instanceof StorageError
            ? err.message
            : "대화를 저장하지 못했어요.",
        kind: "unknown",
      });
    }
    sendToAI(character, resolveUniverseTemplate(universe, allCharacters), next);
  }

  async function handleReset() {
    if (!character || !room) return;
    if (!window.confirm("이 캐릭터와의 대화 기록을 모두 지울까요?")) return;
    try {
      const voiceCharacter = resolveActiveVoiceCharacter(
        character,
        allCharacters,
        room.aiVoiceOverrideId ?? null
      );
      const firstText = voiceCharacter.firstMessage.trim();
      const now = Date.now();
      const seededItems: RoomItem[] = firstText
        ? [{ t: "d", who: voiceCharacter.name, say: firstText, ts: now }]
        : [];
      const next: Room = { ...room, items: seededItems, updatedAt: now };
      setRoom(next);
      await saveRoom(next);
      setError(null);
    } catch (err) {
      setError({
        message:
          err instanceof StorageError
            ? err.message
            : "대화 기록을 지우지 못했어요.",
        kind: "unknown",
      });
    }
  }

  // 채팅방 페이지는 통째로 스크롤되는 구조라(키보드 가림 문제 해결 때
  // 그렇게 바꿨다), 헤더 바로 아래에 끼워 넣는 패널(이름 바꾸기/역할
  // 바꾸기/이전 기록)은 대화 중간까지 스크롤한 상태에서 열면 화면
  // 밖(문서 위쪽)에 그려진다. 여는 순간 맨 위로 스크롤해서 항상
  // 보이게 한다.
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function jumpToDate(date: string) {
    setShowTimeline(false);
    // 패널 닫힘 애니메이션/리렌더와 겹치지 않게 한 틱 뒤에 스크롤한다.
    setTimeout(() => {
      document
        .getElementById(dateAnchorId(date))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function openRename() {
    if (!character) return;
    setRenameText(character.name);
    setRenaming(true);
    scrollToTop();
  }

  function cancelRename() {
    setRenaming(false);
    setRenameText("");
  }

  async function confirmRename() {
    const newName = renameText.trim();
    if (!newName || savingName || !character) return;
    setSavingName(true);
    setError(null);
    try {
      const updated: Character = {
        ...character,
        name: newName,
        updatedAt: Date.now(),
      };
      await saveCharacter(updated);
      setCharacter(updated);
      setAllCharacters((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
      setRenaming(false);
      setRenameText("");
    } catch (err) {
      setError({
        message:
          err instanceof StorageError
            ? err.message
            : "이름을 저장하지 못했어요.",
        kind: "unknown",
      });
    } finally {
      setSavingName(false);
    }
  }

  async function chooseVoice(nextVoiceId: string) {
    if (!character || !room || nextVoiceId === voiceCharacter.id) return;
    const now = Date.now();
    const updated: Room = { ...room, aiVoiceOverrideId: nextVoiceId, updatedAt: now };
    setRoom(updated);
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

  async function choosePlayer(nextPlayerId: string) {
    if (!character || !room) return;
    const current = playerCharacter?.id ?? PLAYER_ANONYMOUS;
    if (nextPlayerId === current) return;
    const now = Date.now();
    const updated: Room = { ...room, playerCharacterId: nextPlayerId, updatedAt: now };
    setRoom(updated);
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

  if (!character || !room) {
    return loadError ? (
      <p className="p-4 text-sm text-red-600">{loadError}</p>
    ) : null;
  }

  const isAu = universe && universe.type === "au";
  const voiceCharacter = resolveActiveVoiceCharacter(
    character,
    allCharacters,
    room.aiVoiceOverrideId ?? null
  );
  const playerCharacter = resolveActivePlayerCharacter(
    character,
    allCharacters,
    voiceCharacter,
    room.playerCharacterId ?? null
  );
  const isReversed = voiceCharacter.id !== character.id;
  const speakerFor = (name: string) =>
    allCharacters.find((c) => c.name === name) ?? voiceCharacter;

  const roomHref = `/character/${id}/chat?universe=${universeId}`;
  const turns = groupByTurn(room.items);
  const messagesForTimeline = groupMessagesByDate(
    roomItemsToChatMessages(room.items)
  );

  return (
    <div className="flex flex-1 lg:gap-6">
      <aside className="hidden w-72 shrink-0 lg:sticky lg:top-6 lg:block lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
        <ChatListPane activeHref={roomHref} />
      </aside>
      <div className="relative flex flex-1 flex-col">
      <TopBar
        title={
          character.name +
          (isReversed
            ? ` · AI: ${voiceCharacter.name}`
            : playerCharacter
              ? ` · 나: ${playerCharacter.name}`
              : "") +
          (isAu ? ` · ${universe.title}` : "")
        }
        right={
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="채팅방 메뉴"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg text-muted transition-transform hover:scale-110 hover:bg-background"
          >
            <MenuIcon />
          </button>
        }
      />

      <ChatMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        canPickRole={allCharacters.length > 1}
        onRename={() => {
          openRename();
          setMenuOpen(false);
        }}
        onPickRole={() => {
          setPickingVoice(true);
          setMenuOpen(false);
          scrollToTop();
        }}
        onShowTimeline={() => {
          setShowTimeline(true);
          setMenuOpen(false);
        }}
        onToggleSplit={() => {
          toggleSplitMode();
          setMenuOpen(false);
        }}
        onOpenBackups={() => {
          setMenuOpen(false);
          scrollToTop();
          openBackups();
        }}
        onReset={() => {
          setMenuOpen(false);
          handleReset();
        }}
      />

      <RenamePanel
        open={renaming}
        value={renameText}
        onChange={setRenameText}
        onCancel={cancelRename}
        onConfirm={confirmRename}
        saving={savingName}
      />

      <RolePickerPanel
        open={pickingVoice}
        character={character}
        allCharacters={allCharacters}
        voiceCharacter={voiceCharacter}
        playerCharacter={playerCharacter}
        onChooseVoice={chooseVoice}
        onChoosePlayer={choosePlayer}
        onClose={() => setPickingVoice(false)}
      />

      <BackupPanel
        backups={backups}
        restoring={restoring}
        onRestore={restoreBackup}
        onClose={closeBackups}
      />

      <TimelinePanel
        open={showTimeline}
        groups={messagesForTimeline}
        onJump={jumpToDate}
        onClose={() => setShowTimeline(false)}
      />

      <main className="flex flex-1 flex-col gap-3 px-3 py-4">
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}

        {splitMode && (
          <p className="rounded-xl border border-dashed border-border px-3 py-2 text-center text-xs text-muted">
            나눌 지점의 &ldquo;여기서부터 나누기&rdquo;를 눌러주세요. 그
            메시지부터 끝까지가 다른 캐릭터 방으로 옮겨져요.
          </p>
        )}
        {splitDone && (
          <p className="card-shadow rounded-xl bg-card px-3 py-2 text-center text-xs text-muted">
            {splitDone.name}와의 방으로 옮겼어요.{" "}
            <Link
              href={`/character/${splitDone.targetId}/chat?universe=${universeId}`}
              className="font-medium text-foreground underline"
            >
              바로 가기
            </Link>
          </p>
        )}

        {turns.map((turn, turnIndex) => {
          const first = turn.items[0];
          const date = kstDateString(first.ts);
          const showDateDivider =
            turnIndex === 0 || kstDateString(turns[turnIndex - 1].items[0].ts) !== date;
          return (
          <div key={`${first.ts}-${turn.startIndex}`} className="flex flex-col gap-1.5">
            {showDateDivider && (
              <div
                id={dateAnchorId(date)}
                className="my-1 flex items-center justify-center scroll-mt-20"
              >
                <span className="rounded-full bg-card px-3 py-1 text-[11px] font-medium text-muted">
                  {formatDateLabel(date)}
                </span>
              </div>
            )}
            {first.t !== "u" ? (
              <div className="flex flex-col gap-2">
                {turn.items.map((item, j) =>
                  item.t === "n" ? (
                    <NarrationBubble
                      key={j}
                      text={item.text}
                      onDelete={() => handleDeleteNarration(turn.startIndex + j)}
                    />
                  ) : item.t === "d" ? (
                    <DialogueBubble
                      key={j}
                      speaker={speakerFor(item.who)}
                      act={item.act}
                      say={item.say}
                      model={item.model}
                      keyIndex={item.keyIndex}
                    />
                  ) : null
                )}
              </div>
            ) : editingIndex === turn.startIndex ? (
              <div className="flex flex-col items-end gap-1.5">
                <textarea
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  autoFocus
                  rows={2}
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
                    className="gradient-primary rounded-full px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                  >
                    수정하고 다시 받기
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => startEdit(turn.startIndex)}
                  disabled={loading}
                  aria-label="메시지 수정"
                  className="shrink-0 text-xs text-muted transition-transform hover:scale-110 hover:text-foreground disabled:opacity-40"
                >
                  <EditIcon />
                </button>
                <div className="flex max-w-[75%] flex-col items-end gap-1 md:max-w-[420px]">
                  {first.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={first.image}
                      alt="보낸 사진"
                      className="max-h-48 w-auto rounded-2xl rounded-br-sm object-cover"
                    />
                  )}
                  {first.text && (
                    <div
                      className="whitespace-pre-wrap rounded-2xl rounded-br-sm px-3 py-2 text-sm leading-relaxed text-white"
                      style={{ backgroundColor: character.accentColor }}
                    >
                      {first.text}
                    </div>
                  )}
                </div>
              </div>
            )}

            {splitMode && splitIndex !== turn.startIndex && (
              <button
                type="button"
                onClick={() => pickSplitPoint(turn.startIndex)}
                className="flex items-center gap-1 self-center rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted hover:text-foreground"
              >
                <ChevronRightIcon /> 여기서부터 나누기
              </button>
            )}

            {splitIndex === turn.startIndex && (
              <div className="card-shadow flex flex-col items-center gap-2 rounded-xl bg-card p-3">
                <p className="text-xs text-muted">
                  이 메시지부터 끝까지를 어느 캐릭터 방으로 옮길까요?
                </p>
                <select
                  value={splitTargetId}
                  onChange={(e) => setSplitTargetId(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background p-2 text-sm outline-none focus:border-primary/50"
                >
                  <option value="">캐릭터 선택</option>
                  {allCharacters
                    .filter((c) => c.id !== id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={cancelSplitPoint}
                    className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={confirmSplit}
                    disabled={!splitTargetId || splitting}
                    className="gradient-primary rounded-full px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                  >
                    {splitting ? "옮기는 중…" : "이 지점부터 옮기기"}
                  </button>
                </div>
              </div>
            )}
          </div>
          );
        })}

        {loading && (
          <div className="flex items-end gap-2">
            <CharacterAvatar character={voiceCharacter} size="sm" />
            <div className="card-shadow rounded-2xl rounded-bl-sm bg-card px-3 py-2 text-sm text-muted">
              입력 중…
            </div>
          </div>
        )}

        {error && (
          <ErrorRetryBanner message={error.message} onRetry={handleRetry} />
        )}

        {/*
          입력창을 fixed나 sticky로 화면에 띄우려면 결국 "키보드가 얼마나
          가리는지"를 알아야 하는데, 이 기기·브라우저에서는 그걸 알아낼
          방법이 없었다(dvh, visualViewport, VirtualKeyboard API 전부
          실패). 그래서 입력창을 아무 위치 지정 없이 대화 목록의 마지막
          항목으로 그냥 둔다 — 페이지 자체의 기본 스크롤에 맡기면,
          이 페이지가 얼마나 긴지와 무관하게 끝까지 스크롤했을 때 항상
          화면에 나타난다.
        */}
        <div className="-mx-3 flex flex-col gap-2 border-t border-border bg-card px-3 py-2">
          {pendingImage && (
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pendingImage}
                alt="첨부할 사진"
                className="h-14 w-14 rounded-lg object-cover"
              />
              <button
                type="button"
                onClick={clearPendingImage}
                className="text-xs text-red-600"
              >
                사진 제거
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <label
              className="shrink-0 cursor-pointer self-stretch rounded-3xl border border-border px-3 py-2 text-sm text-muted"
              aria-label="사진 첨부"
            >
              {pendingImageLoading ? "…" : <CameraIcon />}
              <input
                type="file"
                accept="image/*"
                onChange={handleAttachImage}
                className="hidden"
              />
            </label>
            <AutoGrowTextarea
              value={input}
              onChange={setInput}
              onFocus={handleInputFocus}
              placeholder="메시지를 입력하세요"
              enterKeyHint="enter"
              className="flex-1 resize-none rounded-3xl border border-border bg-background px-4 py-2 text-sm outline-none focus:border-primary/50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={loading || (!input.trim() && !pendingImage)}
              className="gradient-primary shrink-0 rounded-full px-5 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.03] active:scale-[0.97] disabled:opacity-40 disabled:hover:scale-100"
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
