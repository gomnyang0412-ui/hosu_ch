"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CharacterAvatar from "@/components/CharacterAvatar";
import TopBar from "@/components/TopBar";
import { resizeImageFile } from "@/lib/image";
import { deleteCharacter, getCharacters, saveCharacter, StorageQuotaError } from "@/lib/storage";
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
  const [personality, setPersonality] = useState(character?.personality ?? "");
  const [speechStyle, setSpeechStyle] = useState(character?.speechStyle ?? "");
  const [firstMessage, setFirstMessage] = useState(character?.firstMessage ?? "");
  const [image, setImage] = useState<string | undefined>(character?.image);
  const [error, setError] = useState("");
  const [imageLoading, setImageLoading] = useState(false);

  const [accentColor, setAccentColor] = useState<Character["accentColor"]>(
    character?.accentColor ?? ACCENT_COLORS[0]
  );

  useEffect(() => {
    if (!character) {
      setAccentColor(pickAccentColor(getCharacters()));
    }
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

  function handleSave() {
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
      personality,
      speechStyle,
      firstMessage,
      image,
      accentColor,
      createdAt: character?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      saveCharacter(next);
      router.push("/");
    } catch (err) {
      setError(
        err instanceof StorageQuotaError
          ? err.message
          : "저장 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요."
      );
    }
  }

  function handleDelete() {
    if (!character) return;
    if (!window.confirm(`${character.name} 캐릭터와 대화 기록을 모두 삭제할까요?`)) {
      return;
    }
    deleteCharacter(character.id);
    router.push("/");
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

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">이름</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="캐릭터 이름"
            className="rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-foreground/30"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">한 줄 소개</span>
          <input
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value)}
            placeholder="캐릭터를 한 문장으로 설명해 주세요."
            className="rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-foreground/30"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">성격과 배경</span>
          <textarea
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
            placeholder="성격, 과거, 취향 등 캐릭터를 이루는 설정을 적어주세요."
            rows={6}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-foreground/30"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">말투</span>
          <textarea
            value={speechStyle}
            onChange={(e) => setSpeechStyle(e.target.value)}
            placeholder="말투와 어휘, 자주 쓰는 표현 등을 적어주세요."
            rows={4}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-foreground/30"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">첫 인사</span>
          <textarea
            value={firstMessage}
            onChange={(e) => setFirstMessage(e.target.value)}
            placeholder="1:1 대화를 처음 열었을 때 캐릭터가 먼저 건네는 말이에요."
            rows={3}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-foreground/30"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={handleSave}
          className="mt-2 rounded-xl bg-foreground py-3 text-sm font-semibold text-background"
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
