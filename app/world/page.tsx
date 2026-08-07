"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TopBar from "@/components/TopBar";
import { resizeImageFile } from "@/lib/image";
import { getWorld, saveWorld, StorageError } from "@/lib/storage";
import { RELATION_SLOT_COUNT, emptyWorld } from "@/lib/types";

export default function WorldSettingsPage() {
  const router = useRouter();
  const [worldSetting, setWorldSetting] = useState("");
  const [faction, setFaction] = useState("");
  const [relations, setRelations] = useState<string[]>(
    Array(RELATION_SLOT_COUNT).fill("")
  );
  const [glossary, setGlossary] = useState("");
  const [summary, setSummary] = useState("");
  const [image, setImage] = useState<string | undefined>(undefined);
  const [imageLoading, setImageLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const w = await getWorld();
        setWorldSetting(w.worldSetting);
        setFaction(w.faction);
        setRelations(w.relations);
        setGlossary(w.glossary);
        setSummary(w.summary);
        setImage(w.image);
      } catch {
        setError("세계관 설정을 불러오지 못했어요. 새로고침해 주세요.");
      }
    })();
  }, []);

  function updateRelation(index: number, value: string) {
    setRelations((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageLoading(true);
    setError("");
    try {
      setImage(await resizeImageFile(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "이미지 처리에 실패했어요.");
    } finally {
      setImageLoading(false);
    }
  }

  async function handleSave() {
    setError("");
    try {
      await saveWorld({
        ...emptyWorld(),
        worldSetting,
        faction,
        relations,
        glossary,
        summary,
        image,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(
        err instanceof StorageError
          ? err.message
          : "저장 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요."
      );
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title="세계관 설정" onBack={() => router.push("/")} />

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        <p className="text-sm text-muted">
          여기서 설정한 내용은 모든 캐릭터의 대화와 관찰 장면에 함께 반영돼요.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">세계관</span>
          <textarea
            value={worldSetting}
            onChange={(e) => setWorldSetting(e.target.value)}
            placeholder="캐릭터들이 살아가는 시대, 장소, 배경 등을 자유롭게 적어주세요."
            rows={8}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-foreground/30"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">파벌</span>
          <textarea
            value={faction}
            onChange={(e) => setFaction(e.target.value)}
            placeholder="세계관 속 조직, 가문, 학교 내 그룹 등 파벌 구도를 적어주세요."
            rows={5}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-foreground/30"
          />
        </label>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">관계</p>
          {relations.map((value, i) => (
            <label key={i} className="flex flex-col gap-1.5">
              <span className="text-xs text-muted">관계 {i + 1}</span>
              <textarea
                value={value}
                onChange={(e) => updateRelation(i, e.target.value)}
                placeholder="인물이나 파벌 사이의 관계 하나를 자유롭게 적어주세요."
                rows={3}
                className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-foreground/30"
              />
            </label>
          ))}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">용어 및 설정 사전</span>
          <textarea
            value={glossary}
            onChange={(e) => setGlossary(e.target.value)}
            placeholder="이 세계관만의 용어, 지명, 규칙 등을 적어주세요. AI가 세계관을 이해하는 데 도움이 돼요."
            rows={5}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-foreground/30"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">요약</span>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="세계관 전체를 짧게 요약해 주세요."
            rows={4}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-foreground/30"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">이미지</span>
          <div className="flex items-center gap-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-card">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt="세계관 이미지"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xs text-muted">이미지 없음</span>
              )}
            </div>
            <label className="cursor-pointer text-sm font-medium text-muted">
              {imageLoading ? "처리 중..." : "이미지 선택"}
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={handleSave}
          className="mt-2 rounded-xl bg-foreground py-3 text-sm font-semibold text-background"
        >
          {saved ? "저장됨 ✓" : "저장하기"}
        </button>
      </main>
    </div>
  );
}
