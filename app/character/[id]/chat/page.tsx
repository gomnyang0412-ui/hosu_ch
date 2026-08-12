"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import AutoGrowTextarea from "@/components/AutoGrowTextarea";
import CharacterAvatar from "@/components/CharacterAvatar";
import ChatListPane from "@/components/ChatListPane";
import TopBar from "@/components/TopBar";
import BackupPanel from "@/components/chat/BackupPanel";
import ChatMenu from "@/components/chat/ChatMenu";
import RenamePanel from "@/components/chat/RenamePanel";
import RolePickerPanel from "@/components/chat/RolePickerPanel";
import TimelinePanel from "@/components/chat/TimelinePanel";
import {
  dateAnchorId,
  formatDateLabel,
  groupMessagesByDate,
} from "@/lib/chatDates";
import { sourceLabel } from "@/lib/modelLabel";
import { kstDateString, todayKST } from "@/lib/memory";
import {
  getCharacter,
  getCharacters,
  getChatHistory,
  getChatHistoryBackups,
  getChatPlayerOverride,
  getChatVoiceOverride,
  getUniverse,
  restoreChatHistoryBackup,
  saveCharacter,
  saveChatHistory,
  saveChatPlayerOverride,
  saveChatVoiceOverride,
  clearChatHistory,
  StorageError,
} from "@/lib/storage";
import {
  PLAYER_ANONYMOUS,
  resolveActivePlayerCharacter,
  resolveActiveVoiceCharacter,
  resolveVoiceCharacter,
} from "@/lib/character";
import { serializeItems } from "@/lib/scene";
import { resolveUniverseTemplate } from "@/lib/template";
import {
  ORG_UNIVERSE_ID,
  createOrgUniverse,
  toCharacterProfile,
  type Character,
  type ChatMessage,
  type SceneItem,
  type Universe,
} from "@/lib/types";

interface ChatErrorState {
  message: string;
  kind: "quota" | "network" | "overloaded" | "unknown" | "parse";
}

/** items가 없는 예전 메시지는 대사 1개짜리로 감싸서 보여준다 */
function modelItems(m: ChatMessage, characterName: string): SceneItem[] {
  if (m.items && m.items.length > 0) return m.items;
  return [{ t: "d", who: characterName, say: m.text }];
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadError, setLoadError] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ChatErrorState | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [splitMode, setSplitMode] = useState(false);
  const [splitIndex, setSplitIndex] = useState<number | null>(null);
  const [splitTargetId, setSplitTargetId] = useState("");
  const [splitting, setSplitting] = useState(false);
  const [splitDone, setSplitDone] = useState<{ name: string; targetId: string } | null>(
    null
  );
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceOverride, setVoiceOverride] = useState<string | null>(null);
  const [playerOverride, setPlayerOverride] = useState<string | null>(null);
  const [pickingVoice, setPickingVoice] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [backups, setBackups] = useState<
    { value: ChatMessage[]; ts: number }[] | null
  >(null);
  const [restoring, setRestoring] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 키보드 높이를 CSS(dvh)나 JS API(visualViewport, VirtualKeyboard)로
  // 알아내 컨테이너를 줄이거나 입력창을 띄우는 방법을 전부 시도해봤지만,
  // 이 기기·브라우저 조합에서는 어떤 신호도 오지 않아 전부 실패했다.
  // 그래서 이제 키보드를 감지하려는 시도 자체를 하지 않는다. 대신
  // 컨테이너에 인위적인 높이 제한(h-dvh 등)을 아예 두지 않고 페이지가
  // 원래 브라우저의 기본 스크롤을 그대로 쓰게 둔다 — 이건 어떤 실험적
  // API에도 기대지 않는, 모든 모바일 브라우저가 예전부터 지원해온
  // 가장 기본적인 동작이라 여기서마저 안 되지는 않을 것이다. 입력창도
  // 화면에 떠 있게 만들지 않고 대화 목록의 마지막 항목으로 그냥 두어,
  // 페이지를 끝까지 내리면 항상 보이게 한다.
  function handleInputFocus() {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }, 300);
  }

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

      getChatVoiceOverride(universeId, id)
        .then(setVoiceOverride)
        .catch(() => {
          // 저장된 값을 못 불러오면 캐릭터의 기본 역할 반전 설정을 그대로 쓴다
        });
      getChatPlayerOverride(universeId, id)
        .then(setPlayerOverride)
        .catch(() => {
          // 저장된 값을 못 불러오면 기존 암묵적 기본값을 그대로 쓴다
        });

      try {
        const history = await getChatHistory(universeId, id);
        if (history.length === 0 && voiceCharacter.firstMessage.trim()) {
          const firstText = voiceCharacter.firstMessage.trim();
          const seeded: ChatMessage[] = [
            {
              role: "model",
              text: firstText,
              items: [{ t: "d", who: voiceCharacter.name, say: firstText }],
              ts: Date.now(),
            },
          ];
          setMessages(seeded);
          try {
            await saveChatHistory(universeId, id, seeded);
          } catch {
            // 저장 실패해도 화면에는 첫 인사를 보여준다
          }
        } else {
          setMessages(history);
          // 날짜가 넘어간(KST 자정 기준) 뒤 이 방에 처음 들어온 거라면,
          // 지금까지의 대화를 "가져오기"와 같은 방식(최근 100개 상세 +
          // 그 이전 기억 한 줄씩)으로 자동 요약해서 지문으로 남겨둔다.
          const lastMsg = history[history.length - 1];
          if (lastMsg && kstDateString(lastMsg.ts) !== todayKST()) {
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
                  history,
                }),
              });
              const data = await res.json().catch(() => ({}));
              if (res.ok && typeof data.summary === "string" && data.summary.trim()) {
                const recapText = data.summary.trim();
                const withRecap: ChatMessage[] = [
                  ...history,
                  {
                    role: "model",
                    text: recapText,
                    items: [{ t: "n", text: recapText }],
                    ts: Date.now(),
                  },
                ];
                setMessages(withRecap);
                await saveChatHistory(universeId, id, withRecap).catch(() => {});
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, loading]);

  async function sendToAI(
    chatCharacter: Character,
    chatUniverse: Universe,
    history: ChatMessage[]
  ) {
    setLoading(true);
    setError(null);
    const voiceCharacter = resolveActiveVoiceCharacter(
      chatCharacter,
      allCharacters,
      voiceOverride
    );
    const playerName =
      resolveActivePlayerCharacter(
        chatCharacter,
        allCharacters,
        voiceCharacter,
        playerOverride
      )?.name ?? undefined;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          character: toCharacterProfile(voiceCharacter),
          characterId: voiceCharacter.id,
          universe: chatUniverse,
          history,
          playerName,
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
      const items: SceneItem[] = data.items;
      const next: ChatMessage[] = [
        ...history,
        {
          role: "model",
          text: data.text ?? serializeItems(items),
          items,
          ts: Date.now(),
        },
      ];
      setMessages(next);
      try {
        await saveChatHistory(universeId, id, next);
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

  /** 지금 이 방에서 내가 입력하는 메시지가 실제로 누구의 말인지 (기억 정리 시 정확히 구분하기 위해 메시지에 같이 저장해둔다) */
  function currentPlayerName(): string {
    if (!character) return "나";
    const voice = resolveActiveVoiceCharacter(character, allCharacters, voiceOverride);
    return (
      resolveActivePlayerCharacter(character, allCharacters, voice, playerOverride)
        ?.name ?? "나"
    );
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || !character || !universe || loading) return;
    const next: ChatMessage[] = [
      ...messages,
      {
        role: "user",
        text,
        items: [{ t: "d", who: currentPlayerName(), say: text }],
        ts: Date.now(),
      },
    ];
    setMessages(next);
    setInput("");
    try {
      await saveChatHistory(universeId, id, next);
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
    if (!character || !universe) return;
    sendToAI(
      character,
      resolveUniverseTemplate(universe, allCharacters),
      messages
    );
  }

  function startEdit(i: number) {
    if (loading) return;
    setEditingIndex(i);
    setEditingText(messages[i].text);
  }

  function cancelEdit() {
    setEditingIndex(null);
    setEditingText("");
  }

  async function submitEdit() {
    const text = editingText.trim();
    if (!text || editingIndex === null || !character || !universe) return;
    const next: ChatMessage[] = [
      ...messages.slice(0, editingIndex),
      {
        role: "user",
        text,
        items: [{ t: "d", who: currentPlayerName(), say: text }],
        ts: Date.now(),
      },
    ];
    setMessages(next);
    setEditingIndex(null);
    setEditingText("");
    try {
      await saveChatHistory(universeId, id, next);
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
    if (!character) return;
    if (!window.confirm("이 캐릭터와의 대화 기록을 모두 지울까요?")) return;
    try {
      await clearChatHistory(universeId, id);
      const voiceCharacter = resolveActiveVoiceCharacter(
        character,
        allCharacters,
        voiceOverride
      );
      const firstText = voiceCharacter.firstMessage.trim();
      const seeded: ChatMessage[] = firstText
        ? [
            {
              role: "model",
              text: firstText,
              items: [{ t: "d", who: voiceCharacter.name, say: firstText }],
              ts: Date.now(),
            },
          ]
        : [];
      setMessages(seeded);
      if (seeded.length) await saveChatHistory(universeId, id, seeded);
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

  function toggleSplitMode() {
    setSplitMode((v) => !v);
    setSplitIndex(null);
    setSplitTargetId("");
    setSplitDone(null);
  }

  function pickSplitPoint(i: number) {
    setSplitIndex(i);
    setSplitTargetId("");
  }

  async function confirmSplit() {
    if (splitIndex === null || !splitTargetId || splitting) return;
    const target = allCharacters.find((c) => c.id === splitTargetId);
    if (!target) return;
    setSplitting(true);
    setError(null);
    try {
      const head = messages.slice(0, splitIndex);
      const tail = messages.slice(splitIndex);
      const targetExisting = await getChatHistory(universeId, splitTargetId).catch(
        () => []
      );
      await saveChatHistory(universeId, splitTargetId, [...targetExisting, ...tail]);
      await saveChatHistory(universeId, id, head);
      setMessages(head);
      setSplitIndex(null);
      setSplitTargetId("");
      setSplitMode(false);
      setSplitDone({ name: target.name, targetId: target.id });
    } catch (err) {
      setError({
        message:
          err instanceof StorageError
            ? err.message
            : "대화를 옮기지 못했어요.",
        kind: "unknown",
      });
    } finally {
      setSplitting(false);
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
    if (!character || nextVoiceId === voiceCharacter.id) return;
    setVoiceOverride(nextVoiceId);
    try {
      await saveChatVoiceOverride(universeId, id, nextVoiceId);
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
    if (!character) return;
    const current = playerCharacter?.id ?? PLAYER_ANONYMOUS;
    if (nextPlayerId === current) return;
    setPlayerOverride(nextPlayerId);
    try {
      await saveChatPlayerOverride(universeId, id, nextPlayerId);
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

  async function openBackups() {
    setMenuOpen(false);
    setError(null);
    scrollToTop();
    try {
      const list = await getChatHistoryBackups(universeId, id);
      setBackups(list);
    } catch (err) {
      setError({
        message:
          err instanceof StorageError
            ? err.message
            : "이전 기록을 불러오지 못했어요.",
        kind: "unknown",
      });
    }
  }

  async function restoreBackup(index: number) {
    if (restoring) return;
    setRestoring(true);
    setError(null);
    try {
      const restored = await restoreChatHistoryBackup(universeId, id, index);
      setMessages(restored);
      setBackups(null);
    } catch (err) {
      setError({
        message:
          err instanceof StorageError
            ? err.message
            : "이전 기록으로 되돌리지 못했어요.",
        kind: "unknown",
      });
    } finally {
      setRestoring(false);
    }
  }

  // ☰ 메뉴 각 항목의 클릭 처리. 원래 JSX 안에 인라인으로 있던 걸
  // ChatMenu 컴포넌트에 넘겨줄 콜백으로 그대로 옮긴 것뿐이라(동작
  // 순서까지 원래와 동일하게) 실제 로직은 하나도 안 바뀌었다.
  function handleRenameMenuClick() {
    openRename();
    setMenuOpen(false);
  }

  function handlePickRoleMenuClick() {
    setPickingVoice(true);
    setMenuOpen(false);
    scrollToTop();
  }

  function handleTimelineMenuClick() {
    setShowTimeline(true);
    setMenuOpen(false);
  }

  function handleSplitMenuClick() {
    toggleSplitMode();
    setMenuOpen(false);
  }

  function handleResetMenuClick() {
    setMenuOpen(false);
    handleReset();
  }

  if (!character) {
    return loadError ? (
      <p className="p-4 text-sm text-red-600">{loadError}</p>
    ) : null;
  }

  const isAu = universe && universe.type === "au";
  const voiceCharacter = resolveActiveVoiceCharacter(
    character,
    allCharacters,
    voiceOverride
  );
  const playerCharacter = resolveActivePlayerCharacter(
    character,
    allCharacters,
    voiceCharacter,
    playerOverride
  );
  const isReversed = voiceCharacter.id !== character.id;
  const speakerFor = (name: string) =>
    allCharacters.find((c) => c.name === name) ?? voiceCharacter;

  const roomHref = `/character/${id}/chat?universe=${universeId}`;

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
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg text-muted hover:bg-background"
          >
            ☰
          </button>
        }
      />

      <ChatMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        canPickRole={allCharacters.length > 1}
        onRename={handleRenameMenuClick}
        onPickRole={handlePickRoleMenuClick}
        onShowTimeline={handleTimelineMenuClick}
        onToggleSplit={handleSplitMenuClick}
        onOpenBackups={openBackups}
        onReset={handleResetMenuClick}
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
        onClose={() => setBackups(null)}
      />

      <TimelinePanel
        open={showTimeline}
        groups={groupMessagesByDate(messages)}
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

        {messages.map((m, i) => {
          const date = kstDateString(m.ts);
          const showDateDivider =
            i === 0 || kstDateString(messages[i - 1].ts) !== date;
          return (
          <div key={`${m.ts}-${i}`} className="flex flex-col gap-1.5">
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
            {m.role === "model" ? (
              <div className="flex flex-col gap-2">
                {modelItems(m, resolveVoiceCharacter(character, allCharacters).name).map((item, j) =>
                  item.t === "n" ? (
                    <p
                      key={j}
                      className="border-l-2 border-border pl-3 text-[13px] italic leading-relaxed text-muted"
                    >
                      {item.text}
                    </p>
                  ) : (
                    <div key={j} className="flex items-end gap-2">
                      <CharacterAvatar character={speakerFor(item.who)} size="sm" />
                      <div className="flex max-w-[75%] flex-col gap-0.5 md:max-w-[420px]">
                        <div className="card-shadow whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-card px-3 py-2 text-sm leading-relaxed">
                          {item.act && (
                            <p className="mb-1 text-xs italic text-muted">
                              {item.act}
                            </p>
                          )}
                          {item.say}
                        </div>
                        {sourceLabel(item.model, item.keyIndex) && (
                          <span className="pl-1 text-[10px] text-muted/70">
                            {sourceLabel(item.model, item.keyIndex)}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                )}
              </div>
            ) : editingIndex === i ? (
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
                  onClick={() => startEdit(i)}
                  disabled={loading}
                  aria-label="메시지 수정"
                  className="shrink-0 text-xs text-muted hover:text-foreground disabled:opacity-40"
                >
                  ✎
                </button>
                <div
                  className="max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-br-sm px-3 py-2 text-sm leading-relaxed text-white md:max-w-[420px]"
                  style={{ backgroundColor: character.accentColor }}
                >
                  {m.text}
                </div>
              </div>
            )}

            {splitMode && splitIndex !== i && (
              <button
                type="button"
                onClick={() => pickSplitPoint(i)}
                className="self-center rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted hover:text-foreground"
              >
                ▸ 여기서부터 나누기
              </button>
            )}

            {splitIndex === i && (
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
                    onClick={() => setSplitIndex(null)}
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

        {/*
          입력창을 fixed나 sticky로 화면에 띄우려면 결국 "키보드가 얼마나
          가리는지"를 알아야 하는데, 이 기기·브라우저에서는 그걸 알아낼
          방법이 없었다(dvh, visualViewport, VirtualKeyboard API 전부
          실패). 그래서 입력창을 아무 위치 지정 없이 대화 목록의 마지막
          항목으로 그냥 둔다 — 페이지 자체의 기본 스크롤에 맡기면,
          이 페이지가 얼마나 긴지와 무관하게 끝까지 스크롤했을 때 항상
          화면에 나타난다.
        */}
        <div className="-mx-3 flex items-end gap-2 border-t border-border bg-card px-3 py-2">
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
            disabled={loading || !input.trim()}
            className="gradient-primary shrink-0 rounded-full px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            전송
          </button>
        </div>

        <div ref={bottomRef} />
      </main>
      </div>
    </div>
  );
}
