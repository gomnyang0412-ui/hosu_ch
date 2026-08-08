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
  getUniverse,
  saveChatHistory,
  clearChatHistory,
  StorageError,
} from "@/lib/storage";
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const updateHeightRef = useRef<() => void>(() => {});

  // 모바일 브라우저는 키보드가 올라와도 페이지 레이아웃 높이를 그대로 두는
  // 경우가 많아 하단 입력창이 키보드 뒤로 가려질 수 있다. visualViewport로
  // 실제 보이는 높이를 감지해서 채팅 화면 전체 높이를 거기에 맞춘다.
  // 일부 브라우저(예: 삼성 인터넷)는 visualViewport/resize 이벤트를
  // 안정적으로 쏘지 않을 수 있어, 입력창 포커스 시에도 한 번 더 재확인한다.
  useEffect(() => {
    const vv = window.visualViewport;
    const updateHeight = () => {
      setViewportHeight(vv?.height ?? window.innerHeight);
      bottomRef.current?.scrollIntoView({ block: "end" });
    };
    updateHeightRef.current = updateHeight;
    updateHeight();
    vv?.addEventListener("resize", updateHeight);
    vv?.addEventListener("scroll", updateHeight);
    window.addEventListener("resize", updateHeight);
    return () => {
      vv?.removeEventListener("resize", updateHeight);
      vv?.removeEventListener("scroll", updateHeight);
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  // 입력창을 눌러 키보드가 올라오는 시점에도, 애니메이션이 끝난 뒤
  // 실제 보이는 높이를 다시 재본다 (resize 이벤트가 늦거나 안 오는 경우 대비).
  function handleInputFocus() {
    setTimeout(() => updateHeightRef.current(), 350);
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

      try {
        const history = await getChatHistory(universeId, id);
        if (history.length === 0 && found.firstMessage.trim()) {
          const firstText = found.firstMessage.trim();
          const seeded: ChatMessage[] = [
            {
              role: "model",
              text: firstText,
              items: [{ t: "d", who: found.name, say: firstText }],
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
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          character: toCharacterProfile(chatCharacter),
          universe: chatUniverse,
          history,
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

  async function handleSend() {
    const text = input.trim();
    if (!text || !character || !universe || loading) return;
    const next: ChatMessage[] = [
      ...messages,
      { role: "user", text, ts: Date.now() },
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
      { role: "user", text, ts: Date.now() },
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
      const firstText = character.firstMessage.trim();
      const seeded: ChatMessage[] = firstText
        ? [
            {
              role: "model",
              text: firstText,
              items: [{ t: "d", who: character.name, say: firstText }],
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

  if (!character) {
    return loadError ? (
      <p className="p-4 text-sm text-red-600">{loadError}</p>
    ) : null;
  }

  const isAu = universe && universe.type === "au";

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      style={viewportHeight ? { height: viewportHeight } : undefined}
    >
      <TopBar
        title={isAu ? `${character.name} · ${universe.title}` : character.name}
        right={
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleReset}
              aria-label="대화 초기화"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-background"
            >
              ↺
            </button>
            <Link
              href={`/character/${id}/edit`}
              aria-label="캐릭터 설정 편집"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-background"
            >
              ✎
            </Link>
          </div>
        }
      />

      <main className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-4">
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}
        {messages.map((m, i) =>
          m.role === "model" ? (
            <div key={`${m.ts}-${i}`} className="flex flex-col gap-2">
              {modelItems(m, character.name).map((item, j) =>
                item.t === "n" ? (
                  <p
                    key={j}
                    className="border-l-2 border-border pl-3 text-[13px] italic leading-relaxed text-muted"
                  >
                    {item.text}
                  </p>
                ) : (
                  <div key={j} className="flex items-end gap-2">
                    <CharacterAvatar character={character} size="sm" />
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
            <div key={`${m.ts}-${i}`} className="flex flex-col items-end gap-1.5">
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
                  className="rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background disabled:opacity-40"
                >
                  수정하고 다시 받기
                </button>
              </div>
            </div>
          ) : (
            <div key={`${m.ts}-${i}`} className="flex items-center justify-end gap-1.5">
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
          )
        )}

        {loading && (
          <div className="flex items-end gap-2">
            <CharacterAvatar character={character} size="sm" />
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

        <div ref={bottomRef} />
      </main>

      <footer className="sticky bottom-0 flex items-end gap-2 border-t border-border bg-card px-3 py-2">
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
          className="max-h-32 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="shrink-0 rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-40"
        >
          전송
        </button>
      </footer>
    </div>
  );
}
