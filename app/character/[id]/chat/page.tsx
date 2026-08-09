"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import CharacterAvatar from "@/components/CharacterAvatar";
import TopBar from "@/components/TopBar";
import {
  getCharacter,
  getCharacters,
  getChatHistory,
  getChatPlayerOverride,
  getChatVoiceOverride,
  getUniverse,
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
  kind: "quota" | "network" | "unknown" | "parse";
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

  function openRename() {
    if (!character) return;
    setRenameText(character.name);
    setRenaming(true);
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

  return (
    <div className="relative flex flex-col lg:flex-1">
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

      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="메뉴 닫기"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-3 top-14 z-20 flex w-56 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
            <button
              type="button"
              onClick={() => {
                openRename();
                setMenuOpen(false);
              }}
              className="px-4 py-3 text-left text-sm hover:bg-background"
            >
              ✎ 채팅방 이름 바꾸기
            </button>
            {allCharacters.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setPickingVoice(true);
                  setMenuOpen(false);
                }}
                className="border-t border-border px-4 py-3 text-left text-sm hover:bg-background"
              >
                🎭 역할 바꾸기 (AI / 나)
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                toggleSplitMode();
                setMenuOpen(false);
              }}
              className="border-t border-border px-4 py-3 text-left text-sm hover:bg-background"
            >
              ✂ 대화 나누기
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                handleReset();
              }}
              className="border-t border-border px-4 py-3 text-left text-sm text-red-600 hover:bg-background"
            >
              ↺ 대화 초기화
            </button>
          </div>
        </>
      )}

      {renaming && (
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
          <input
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            autoFocus
            placeholder="채팅방 이름"
            className="min-w-0 flex-1 rounded-xl border border-border bg-background p-2 text-sm outline-none focus:border-primary/50"
          />
          <button
            type="button"
            onClick={cancelRename}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted"
          >
            취소
          </button>
          <button
            type="button"
            onClick={confirmRename}
            disabled={!renameText.trim() || savingName}
            className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
          >
            {savingName ? "저장 중…" : "저장"}
          </button>
        </div>
      )}

      {pickingVoice && (
        <div className="flex flex-col gap-2 border-b border-border bg-card px-3 py-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            AI가 연기
            <select
              value={voiceCharacter.id}
              onChange={(e) => chooseVoice(e.target.value)}
              className="rounded-xl border border-border bg-background p-2 text-sm text-foreground outline-none focus:border-primary/50"
            >
              {allCharacters.map((c) => (
                <option
                  key={c.id}
                  value={c.id}
                  disabled={playerCharacter?.id === c.id}
                >
                  {c.id === character.id ? `${c.name} (기본, 본인)` : c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            나는
            <select
              value={playerCharacter?.id ?? PLAYER_ANONYMOUS}
              onChange={(e) => choosePlayer(e.target.value)}
              className="rounded-xl border border-border bg-background p-2 text-sm text-foreground outline-none focus:border-primary/50"
            >
              <option value={PLAYER_ANONYMOUS}>이름 없는 사용자 (기본)</option>
              {allCharacters.map((c) => (
                <option
                  key={c.id}
                  value={c.id}
                  disabled={c.id === voiceCharacter.id}
                >
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setPickingVoice(false)}
            className="self-end rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted"
          >
            닫기
          </button>
        </div>
      )}

      <main className="flex flex-1 flex-col gap-3 px-3 py-4">
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}

        {splitMode && (
          <p className="rounded-xl border border-dashed border-border px-3 py-2 text-center text-xs text-muted">
            나눌 지점의 &ldquo;여기서부터 나누기&rdquo;를 눌러주세요. 그
            메시지부터 끝까지가 다른 캐릭터 방으로 옮겨져요.
          </p>
        )}
        {splitDone && (
          <p className="rounded-xl border border-border bg-card px-3 py-2 text-center text-xs text-muted">
            {splitDone.name}와의 방으로 옮겼어요.{" "}
            <Link
              href={`/character/${splitDone.targetId}/chat?universe=${universeId}`}
              className="font-medium text-foreground underline"
            >
              바로 가기
            </Link>
          </p>
        )}

        {messages.map((m, i) => (
          <div key={`${m.ts}-${i}`} className="flex flex-col gap-1.5">
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
                      <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-card border border-border px-3 py-2 text-sm leading-relaxed md:max-w-[420px]">
                        {item.act && (
                          <p className="mb-1 text-xs italic text-muted">
                            {item.act}
                          </p>
                        )}
                        {item.say}
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
                    className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40"
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
              <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-3">
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
                    className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                  >
                    {splitting ? "옮기는 중…" : "이 지점부터 옮기기"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-end gap-2">
            <CharacterAvatar character={voiceCharacter} size="sm" />
            <div className="rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm text-muted">
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
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={handleInputFocus}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="메시지를 입력하세요"
            rows={1}
            className="max-h-32 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            전송
          </button>
        </div>

        <div ref={bottomRef} />
      </main>
    </div>
  );
}
