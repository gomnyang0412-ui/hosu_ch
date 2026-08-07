"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import CharacterAvatar from "@/components/CharacterAvatar";
import TopBar from "@/components/TopBar";
import {
  getCharacter,
  getChatHistory,
  getWorld,
  saveChatHistory,
  clearChatHistory,
  StorageQuotaError,
} from "@/lib/storage";
import { toCharacterProfile, type Character, type ChatMessage } from "@/lib/types";

interface ChatErrorState {
  message: string;
  kind: "quota" | "network" | "unknown";
}

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [character, setCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ChatErrorState | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const found = getCharacter(id);
    if (!found) {
      router.replace("/");
      return;
    }
    setCharacter(found);

    const history = getChatHistory(id);
    if (history.length === 0 && found.firstMessage.trim()) {
      const seeded: ChatMessage[] = [
        { role: "model", text: found.firstMessage.trim(), ts: Date.now() },
      ];
      setMessages(seeded);
      try {
        saveChatHistory(id, seeded);
      } catch {
        // 저장 실패해도 화면에는 첫 인사를 보여준다
      }
    } else {
      setMessages(history);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, loading]);

  async function sendToAI(chatCharacter: Character, history: ChatMessage[]) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          character: toCharacterProfile(chatCharacter),
          world: getWorld(),
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
      const next: ChatMessage[] = [
        ...history,
        { role: "model", text: data.reply, ts: Date.now() },
      ];
      setMessages(next);
      try {
        saveChatHistory(id, next);
      } catch (err) {
        setError({
          message:
            err instanceof StorageQuotaError
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

  function handleSend() {
    const text = input.trim();
    if (!text || !character || loading) return;
    const next: ChatMessage[] = [
      ...messages,
      { role: "user", text, ts: Date.now() },
    ];
    setMessages(next);
    setInput("");
    try {
      saveChatHistory(id, next);
    } catch (err) {
      setError({
        message:
          err instanceof StorageQuotaError
            ? err.message
            : "대화를 저장하지 못했어요.",
        kind: "unknown",
      });
    }
    sendToAI(character, next);
  }

  function handleRetry() {
    if (!character) return;
    sendToAI(character, messages);
  }

  function handleReset() {
    if (!character) return;
    if (!window.confirm("이 캐릭터와의 대화 기록을 모두 지울까요?")) return;
    clearChatHistory(id);
    const seeded: ChatMessage[] = character.firstMessage.trim()
      ? [{ role: "model", text: character.firstMessage.trim(), ts: Date.now() }]
      : [];
    setMessages(seeded);
    if (seeded.length) saveChatHistory(id, seeded);
    setError(null);
  }

  if (!character) return null;

  return (
    <div className="flex flex-1 flex-col">
      <TopBar
        title={character.name}
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
        {messages.map((m, i) =>
          m.role === "model" ? (
            <div key={`${m.ts}-${i}`} className="flex items-end gap-2">
              <CharacterAvatar character={character} size="sm" />
              <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-card border border-border px-3 py-2 text-sm leading-relaxed md:max-w-[420px]">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={`${m.ts}-${i}`} className="flex justify-end">
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
