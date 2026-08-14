"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CharacterAvatar from "@/components/CharacterAvatar";
import TopBar from "@/components/TopBar";
import { resizeImageFile } from "@/lib/image";
import { serializeRoomItems } from "@/lib/scene";
import {
  deleteCharacter,
  getChatHistory,
  getCharacters,
  getStories,
  listRooms,
  saveCharacter,
  StorageError,
} from "@/lib/storage";
import {
  ACCENT_COLORS,
  ORG_UNIVERSE_ID,
  type Character,
  type ChatMessage,
} from "@/lib/types";

/** 이 캐릭터에 대해 참고할 수 있는 자료(1:1 대화·관찰 모드·단톡방)를
 *  ORG 유니버스에서만 모아온다. AU는 다른 세계관 설정이라 참고 대상에서
 *  뺀다. */
async function gatherReferenceMaterial(
  characterId: string,
  allCharacters: Character[]
): Promise<{
  history: ChatMessage[];
  observationTexts: string[];
  groupChatTexts: string[];
}> {
  const [history, stories, rooms] = await Promise.all([
    getChatHistory(ORG_UNIVERSE_ID, characterId).catch(() => []),
    getStories(ORG_UNIVERSE_ID).catch(() => []),
    listRooms(ORG_UNIVERSE_ID).catch(() => []),
  ]);
  const observationTexts = stories
    .filter((s) => s.characterIds.includes(characterId))
    .flatMap((s) => s.episodes.map((e) => e.text));
  const groupChatTexts = rooms
    .filter((r) => r.kind === "group" && r.characterIds.includes(characterId))
    .map((r) => {
      const playerName = r.playerCharacterId
        ? allCharacters.find((c) => c.id === r.playerCharacterId)?.name
        : undefined;
      return serializeRoomItems(r.items, playerName);
    });
  return { history, observationTexts, groupChatTexts };
}

function pickAccentColor(existing: Character[]): Character["accentColor"] {
  return ACCENT_COLORS[existing.length % ACCENT_COLORS.length];
}

type ProfileFieldKey =
  | "oneLiner"
  | "goal"
  | "appearance"
  | "scentNote"
  | "personality"
  | "speechStyle"
  | "background"
  | "lifeHistory"
  | "relatedCharacters"
  | "romance"
  | "firstMessage";

const PROFILE_FIELD_LABELS: Record<ProfileFieldKey, string> = {
  oneLiner: "한 줄 소개",
  goal: "목표",
  appearance: "외형 특징",
  scentNote: "향 노트",
  personality: "성격",
  speechStyle: "말투",
  background: "배경 이야기",
  lifeHistory: "살아온 궤적",
  relatedCharacters: "연관 인물",
  romance: "애정 관계",
  firstMessage: "첫 인사",
};

type ProfileSuggestions = Partial<Record<ProfileFieldKey, string>>;

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
  const [referenceImage, setReferenceImage] = useState<string | undefined>(
    character?.referenceImage
  );
  const [error, setError] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const [referenceImageLoading, setReferenceImageLoading] = useState(false);

  const [accentColor, setAccentColor] = useState<Character["accentColor"]>(
    character?.accentColor ?? ACCENT_COLORS[0]
  );
  const [aiVoiceCharacterId, setAiVoiceCharacterId] = useState(
    character?.aiVoiceCharacterId ?? ""
  );
  const [otherCharacters, setOtherCharacters] = useState<Character[]>([]);

  const [hasReferenceMaterial, setHasReferenceMaterial] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  const [suggestions, setSuggestions] = useState<ProfileSuggestions | null>(
    null
  );

  useEffect(() => {
    getCharacters()
      .then((existing) => {
        if (!character) setAccentColor(pickAccentColor(existing));
        setOtherCharacters(existing.filter((c) => c.id !== character?.id));
        if (character) {
          gatherReferenceMaterial(character.id, existing)
            .then(({ history, observationTexts, groupChatTexts }) =>
              setHasReferenceMaterial(
                history.length > 0 ||
                  observationTexts.length > 0 ||
                  groupChatTexts.length > 0
              )
            )
            .catch(() => {
              // 확인 못 해도 버튼을 숨기기만 할 뿐, 편집 자체는 계속할 수 있다
            });
        }
      })
      .catch(() => {
        // 실패해도 기본 색이 이미 지정되어 있으니 조용히 넘어간다
      });
    // 새 캐릭터일 때만 클라이언트에서 색을 배정한다 (서버 렌더링과의 불일치 방지)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const profileFieldState: Record<ProfileFieldKey, [string, (v: string) => void]> = {
    oneLiner: [oneLiner, setOneLiner],
    goal: [goal, setGoal],
    appearance: [appearance, setAppearance],
    scentNote: [scentNote, setScentNote],
    personality: [personality, setPersonality],
    speechStyle: [speechStyle, setSpeechStyle],
    background: [background, setBackground],
    lifeHistory: [lifeHistory, setLifeHistory],
    relatedCharacters: [relatedCharacters, setRelatedCharacters],
    romance: [romance, setRomance],
    firstMessage: [firstMessage, setFirstMessage],
  };

  async function handleSuggestProfile() {
    if (!character) return;
    setSuggesting(true);
    setSuggestError("");
    setSuggestions(null);
    try {
      const { history, observationTexts, groupChatTexts } =
        await gatherReferenceMaterial(character.id, [...otherCharacters, character]);
      if (
        history.length === 0 &&
        observationTexts.length === 0 &&
        groupChatTexts.length === 0
      ) {
        setSuggestError("아직 이 캐릭터에 대해 참고할 대화나 이야기가 없어요.");
        return;
      }
      const res = await fetch("/api/character-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          character: {
            name,
            oneLiner,
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
          },
          history,
          observationTexts,
          groupChatTexts,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSuggestError(data.error ?? "설정을 다듬지 못했어요.");
        return;
      }
      setSuggestions(data.profile ?? {});
    } catch {
      setSuggestError("네트워크 문제로 설정을 다듬지 못했어요.");
    } finally {
      setSuggesting(false);
    }
  }

  function applySuggestion(key: ProfileFieldKey, value: string) {
    profileFieldState[key][1](value);
    // 적용한 항목은 목록에서 바로 지워서 "눌렀다"는 걸 확인할 수 있게 한다 —
    // 안 그러면 카드는 그대로 있고 실제로 바뀐 입력창은 화면 아래로 스크롤해야
    // 보여서, 클릭이 씹힌 것처럼 느껴진다.
    setSuggestions((prev) => {
      if (!prev) return prev;
      const rest = { ...prev };
      delete rest[key];
      const hasRemaining = (
        Object.keys(PROFILE_FIELD_LABELS) as ProfileFieldKey[]
      ).some((k) => rest[k]);
      return hasRemaining ? rest : null;
    });
  }

  function applyAllSuggestions() {
    if (!suggestions) return;
    for (const key of Object.keys(PROFILE_FIELD_LABELS) as ProfileFieldKey[]) {
      const value = suggestions[key];
      if (value) applySuggestion(key, value);
    }
    setSuggestions(null);
  }

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

  async function handleReferenceImageChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReferenceImageLoading(true);
    setError("");
    try {
      // 전신 사진 등 참고용이라 아바타(320px)보다 좀 더 크게 남겨둔다
      const dataUrl = await resizeImageFile(file, 640);
      setReferenceImage(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "이미지 처리에 실패했어요.");
    } finally {
      setReferenceImageLoading(false);
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
      referenceImage,
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
        <div className="flex flex-col items-center gap-3">
          <CharacterAvatar
            character={{ name: name || "?", image, accentColor }}
            size="xl"
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

        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3">
          <span className="text-sm font-medium">참고 이미지 (전신 사진 등)</span>
          <p className="text-xs text-muted">
            대화 화면 등에 보이는 프로필 사진과는 별개예요. 이 편집 화면에서만
            보여지는 참고용이에요.
          </p>
          {referenceImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={referenceImage}
              alt="참고 이미지"
              className="w-full rounded-xl border border-border"
            />
          )}
          <div className="flex items-center gap-3">
            <label className="cursor-pointer text-sm font-medium text-muted">
              {referenceImageLoading
                ? "처리 중..."
                : referenceImage
                  ? "이미지 변경"
                  : "이미지 추가"}
              <input
                type="file"
                accept="image/*"
                onChange={handleReferenceImageChange}
                className="hidden"
              />
            </label>
            {referenceImage && (
              <button
                type="button"
                onClick={() => setReferenceImage(undefined)}
                className="text-xs text-red-600"
              >
                삭제
              </button>
            )}
          </div>
        </div>

        {isEdit && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSuggestProfile}
              disabled={suggesting || !hasReferenceMaterial}
              className="self-start rounded-full bg-accent px-3 py-2 text-xs font-medium text-accent-foreground disabled:opacity-40"
            >
              {suggesting ? "대화 참고해서 다듬는 중…" : "✨ 대화 참고해서 설정 다듬기"}
            </button>
            {!hasReferenceMaterial && (
              <p className="text-xs text-muted">
                아직 이 캐릭터에 대해 참고할 1:1 대화·관찰 기록·단톡방 대화가 없어요.
              </p>
            )}
            {suggestError && (
              <p className="text-xs text-red-600">{suggestError}</p>
            )}

            {suggestions && (
              <div className="flex flex-col gap-3 rounded-2xl border border-primary/40 bg-card p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">AI가 다듬은 설정 제안</p>
                  <button
                    type="button"
                    onClick={() => setSuggestions(null)}
                    className="text-xs text-muted"
                  >
                    닫기
                  </button>
                </div>
                {(Object.keys(PROFILE_FIELD_LABELS) as ProfileFieldKey[]).some(
                  (key) => suggestions[key]
                ) ? (
                  <>
                    <p className="text-xs text-muted">
                      마음에 드는 항목만 골라 적용하세요. 적용하기 전까지는
                      아무것도 바뀌지 않아요.
                    </p>
                    <div className="flex flex-col gap-3">
                      {(Object.keys(PROFILE_FIELD_LABELS) as ProfileFieldKey[])
                        .filter((key) => suggestions[key])
                        .map((key) => (
                          <div
                            key={key}
                            className="flex flex-col gap-1 rounded-xl bg-background p-2.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold">
                                {PROFILE_FIELD_LABELS[key]}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  applySuggestion(key, suggestions[key] as string)
                                }
                                className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground"
                              >
                                적용
                              </button>
                            </div>
                            <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                              {suggestions[key]}
                            </p>
                          </div>
                        ))}
                    </div>
                    <button
                      type="button"
                      onClick={applyAllSuggestions}
                      className="rounded-xl border border-border py-2 text-xs font-semibold"
                    >
                      전체 적용
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-muted">
                    대화에서 새로 다듬을 만한 내용을 찾지 못했어요.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

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
