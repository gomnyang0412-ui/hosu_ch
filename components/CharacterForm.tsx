"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CharacterAvatar from "@/components/CharacterAvatar";
import TopBar from "@/components/TopBar";
import { resizeImageFile } from "@/lib/image";
import { deleteCharacter, getCharacters, saveCharacter, StorageError } from "@/lib/storage";
import { ACCENT_COLORS, type Character } from "@/lib/types";

function pickAccentColor(existing: Character[]): Character["accentColor"] {
  return ACCENT_COLORS[existing.length % ACCENT_COLORS.length];
}

export default function CharacterForm({
  character,
}: {
  character?: Character;
}) {
  const router = useRouter();
  const isEdit = !!character;

  const [name, setName] = useState(character?.name ?? "");
  const [oneLiner, setOneLiner] = useState(character?.oneLiner ?? "");
  const [goal, setGoal] = useState(character?.goal ?? "");
  const [appearance, setAppearance] = useState(character?.appearance ?? "");
  const [scentNote, setScentNote] = useState(character?.scentNote ?? "");
  const [personality, setPersonality] = useState(character?.personality ?? "");
  const [speechStyle, setSpeechStyle] = useState(character?.speechStyle ?? "");
  const [background, setBackground] = useState(character?.background ?? "");
  const [lifeHistory, setLifeHistory] = useState(character?.lifeHistory ?? "");
  const [relatedCharacters, setRelatedCharacters] = useState(
    character?.relatedCharacters ?? ""
  );
  const [romance, setRomance] = useState(character?.romance ?? "");
  const [firstMessage, setFirstMessage] = useState(character?.firstMessage ?? "");
  const [image, setImage] = useState<string | undefined>(character?.image);
  const [error, setError] = useState("");
  const [imageLoading, setImageLoading] = useState(false);

  const [accentColor, setAccentColor] = useState<Character["accentColor"]>(
    character?.accentColor ?? ACCENT_COLORS[0]
  );
  const [aiVoiceCharacterId, setAiVoiceCharacterId] = useState(
    character?.aiVoiceCharacterId ?? ""
  );
  const [otherCharacters, setOtherCharacters] = useState<Character[]>([]);

  useEffect(() => {
    getCharacters()
      .then((existing) => {
        if (!character) setAccentColor(pickAccentColor(existing));
        setOtherCharacters(existing.filter((c) => c.id !== character?.id));
      })
      .catch(() => {
        // 실패해도 기본 색이 이미 지정되어 있으니 조용히 넘어간다
      });
    // 새 캐릭터일 때만 클라이언트에서 색을 배정한다 (서버 렌더링과의 불일치 방지)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageLoading(true);
    setError("");
    try {
      const dataUrl = await resizeImageFile(file);
      setImage(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "이미지 처리에 실패했어요.");
    } finally {
      setImageLoading(false);
    }
  }

  async function handleSave() {
    setError("");
    if (!name.trim()) {
      setError("이름을 입력해 주세요.");
      return;
    }
    const now = Date.now();
    const next: Character = {
      id: character?.id ?? crypto.randomUUID(),
      name: name.trim(),
      oneLiner: oneLiner.trim(),
      goal,
      appearance,
      scentNote,
      personality,
      speechStyle,
      background,
      lifeHistory,
      relatedCharacters,
      romance,
      firstMessage,
      image,
      accentColor,
      aiVoiceCharacterId: aiVoiceCharacterId || undefined,
      createdAt: character?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      await saveCharacter(next);
      router.push("/");
    } catch (err) {
      setError(
        err instanceof StorageError
          ? err.message
          : "저장 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요."
      );
    }
  }

  async function handleDelete() {
    if (!character) return;
    if (!window.confirm(`${character.name} 캐릭터와 대화 기록을 모두 삭제할까요?`)) {
      return;
    }
    try {
      await deleteCharacter(character.id);
      router.push("/");
    } catch (err) {
      setError(
        err instanceof StorageError
          ? err.message
          : "삭제 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요."
      );
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title={isEdit ? "캐릭터 편집" : "캐릭터 추가"} />

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        <div className="flex flex-col items-center gap-2">
          <CharacterAvatar
            character={{ name: name || "?", image, accentColor }}
            size="lg"
          />
          <label className="cursor-pointer text-sm font-medium text-muted">
            {imageLoading ? "처리 중..." : "프로필 이미지 선택"}
            <input
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="hidden"
            />
          </label>
        </div>

        <div className="flex flex-col items-center gap-2">
          <span className="text-sm font-medium">강조색</span>
          <div className="flex gap-2">
            {ACCENT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`강조색 ${color}`}
                onClick={() => setAccentColor(color)}
                className="h-8 w-8 shrink-0 rounded-full transition-transform"
                style={{
                  backgroundColor: color,
                  outline:
                    accentColor === color
                      ? "2px solid var(--foreground)"
                      : "2px solid transparent",
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">이름</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="캐릭터 이름"
            className="rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">한 줄 소개</span>
          <input
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value)}
            placeholder="캐릭터를 한 문장으로 설명해 주세요."
            className="rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">목표</span>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="캐릭터가 이루고 싶어 하는 것, 원하는 것을 적어주세요."
            rows={3}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">외형 특징</span>
          <textarea
            value={appearance}
            onChange={(e) => setAppearance(e.target.value)}
            placeholder="키, 체형, 헤어, 옷차림 등 겉모습을 적어주세요."
            rows={4}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">향 노트</span>
          <textarea
            value={scentNote}
            onChange={(e) => setScentNote(e.target.value)}
            placeholder="이 캐릭터를 떠올리게 하는 향, 분위기를 적어주세요."
            rows={3}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">성격</span>
          <textarea
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
            placeholder="성격, 가치관, 취향 등을 적어주세요."
            rows={5}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">말투</span>
          <textarea
            value={speechStyle}
            onChange={(e) => setSpeechStyle(e.target.value)}
            placeholder="말투와 어휘, 자주 쓰는 표현 등을 적어주세요."
            rows={4}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">배경 이야기</span>
          <textarea
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            placeholder="이 캐릭터를 둘러싼 상황이나 설정을 적어주세요."
            rows={5}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">살아온 궤적</span>
          <textarea
            value={lifeHistory}
            onChange={(e) => setLifeHistory(e.target.value)}
            placeholder="어린 시절부터 지금까지 겪어온 일들을 적어주세요."
            rows={5}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">연관 인물</span>
          <textarea
            value={relatedCharacters}
            onChange={(e) => setRelatedCharacters(e.target.value)}
            placeholder="가족, 친구, 라이벌 등 이 캐릭터와 개인적으로 얽힌 인물을 적어주세요."
            rows={4}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">애정 관계</span>
          <textarea
            value={romance}
            onChange={(e) => setRomance(e.target.value)}
            placeholder="짝사랑, 연인 등 애정과 관련된 관계를 적어주세요."
            rows={4}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">첫 인사</span>
          <textarea
            value={firstMessage}
            onChange={(e) => setFirstMessage(e.target.value)}
            placeholder="1:1 대화를 처음 열었을 때 캐릭터가 먼저 건네는 말이에요."
            rows={3}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
        </label>

        {isEdit && (
          <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3">
            <span className="text-sm font-medium">역할 반전</span>
            <p className="text-xs text-muted">
              이 캐릭터의 1:1 방에서, AI가 &ldquo;{name || "이 캐릭터"}
              &rdquo;가 아니라 아래에서 고른 다른 캐릭터를 연기하게 해요.
              대신 내가 입력하는 메시지는 &ldquo;{name || "이 캐릭터"}
              &rdquo;가 하는 말로 취급돼요.
            </p>
            {otherCharacters.length === 0 ? (
              <p className="text-xs text-muted">
                아직 다른 캐릭터가 없어요. 먼저 캐릭터를 추가해 주세요.
              </p>
            ) : (
              <select
                value={aiVoiceCharacterId}
                onChange={(e) => setAiVoiceCharacterId(e.target.value)}
                className="rounded-xl border border-border bg-background p-2.5 text-sm outline-none focus:border-primary/50"
              >
                <option value="">사용 안 함 (기본: 이 캐릭터 자신)</option>
                {otherCharacters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={handleSave}
          className="mt-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
        >
          저장하기
        </button>

        {isEdit && (
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-xl border border-red-200 py-3 text-sm font-semibold text-red-600"
          >
            캐릭터 삭제
          </button>
        )}
      </main>
    </div>
  );
}
