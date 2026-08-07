"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TopBar from "@/components/TopBar";
import { getWorld, saveWorld, StorageQuotaError } from "@/lib/storage";

export default function WorldSettingsPage() {
  const router = useRouter();
  const [worldSetting, setWorldSetting] = useState("");
  const [relatedPeople, setRelatedPeople] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const w = getWorld();
    setWorldSetting(w.worldSetting);
    setRelatedPeople(w.relatedPeople);
  }, []);

  function handleSave() {
    setError("");
    try {
      saveWorld({ worldSetting, relatedPeople });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(
        err instanceof StorageQuotaError
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
          <span className="text-sm font-medium">관계 인물</span>
          <textarea
            value={relatedPeople}
            onChange={(e) => setRelatedPeople(e.target.value)}
            placeholder="대화 상대는 아니지만 캐릭터들이 알고 있어야 할 인물과 관계를 적어주세요."
            rows={8}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-foreground/30"
          />
        </label>

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
