"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CharacterAvatar from "@/components/CharacterAvatar";
import TopBar from "@/components/TopBar";
import { getCharacters, saveChatVoiceOverride, StorageError } from "@/lib/storage";
import { ORG_UNIVERSE_ID, type Character } from "@/lib/types";

export default function NewSingleChatPage() {
  const router = useRouter();
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const [selfId, setSelfId] = useState("");
  const [voiceId, setVoiceId] = useState(""); // "" = AI가 selfId 본인을 그대로 연기
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getCharacters()
      .then((chars) => {
        setCharacters(chars);
        if (chars.length > 0) setSelfId(chars[0].id);
      })
      .catch(() => setError("캐릭터 목록을 불러오지 못했어요."));
  }, []);

  const selfCharacter = characters?.find((c) => c.id === selfId);
  const voiceCharacter = characters?.find((c) => c.id === voiceId);
  const others = characters?.filter((c) => c.id !== selfId) ?? [];

  function handleSelfChange(nextSelfId: string) {
    setSelfId(nextSelfId);
    if (voiceId === nextSelfId) setVoiceId("");
  }

  async function handleCreate() {
    if (!selfId || creating) return;
    setCreating(true);
    setError("");
    try {
      // 비워두면(B 선택 안 함) 카드에 저장된 다른 기본 반전 설정이 몰래
      // 적용되지 않도록, "AI가 selfId 본인을 연기"를 명시적으로 저장한다
      // — 방금 화면에서 보여준 미리보기와 항상 일치하게 하기 위함.
      await saveChatVoiceOverride(ORG_UNIVERSE_ID, selfId, voiceId || selfId);
      router.push(`/character/${selfId}/chat`);
    } catch (err) {
      setError(
        err instanceof StorageError
          ? err.message
          : "대화방을 만들지 못했어요. 잠시 후 다시 시도해 주세요."
      );
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title="새 1:1 대화방" />

      <main className="mx-auto w-full max-w-[680px] flex-1 px-4 py-4">
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {characters === null ? null : characters.length === 0 ? (
          <p className="mt-8 text-center text-sm text-muted">
            아직 캐릭터가 없어요.
            <br />
            캐릭터 탭에서 먼저 캐릭터를 추가해 주세요.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                A — 내 입장이 될 캐릭터 (이 방의 주인)
              </span>
              <select
                value={selfId}
                onChange={(e) => handleSelfChange(e.target.value)}
                className="rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-primary/50"
              >
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                B — AI가 연기할 캐릭터 (선택)
              </span>
              <select
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                disabled={others.length === 0}
                className="rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-primary/50 disabled:opacity-50"
              >
                <option value="">사용 안 함 (AI가 {selfCharacter?.name ?? "A"} 본인을 연기)</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
              {selfCharacter && (
                <CharacterAvatar
                  character={voiceCharacter ?? selfCharacter}
                  size="md"
                />
              )}
              <p className="text-sm leading-relaxed text-muted">
                {selfCharacter && voiceCharacter ? (
                  <>
                    <b className="text-foreground">{selfCharacter.name}</b> 입장에서{" "}
                    <b className="text-foreground">{voiceCharacter.name}</b>와 대화해요.
                    내가 입력하는 메시지는 {selfCharacter.name}가 하는 말로,
                    AI는 {voiceCharacter.name}를 연기해요.
                  </>
                ) : selfCharacter ? (
                  <>
                    <b className="text-foreground">{selfCharacter.name}</b>와(과) 평범하게
                    1:1로 대화해요. AI가 {selfCharacter.name} 본인을 연기해요.
                  </>
                ) : (
                  "캐릭터를 선택해 주세요."
                )}
              </p>
            </div>

            <button
              type="button"
              onClick={handleCreate}
              disabled={!selfId || creating}
              className="rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >
              {creating ? "만드는 중…" : "대화 시작하기"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
