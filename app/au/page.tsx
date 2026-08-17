"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BottomNav from "@/components/BottomNav";
import { EditIcon, GlobeIcon, SparkleIcon, WarningIcon } from "@/components/icons";
import { moodPlaceholderImage } from "@/lib/image";
import { SAMPLE_AUS } from "@/lib/sampleAus";
import { getUniverses, saveUniverse, StorageError } from "@/lib/storage";
import { hasUnresolvedRoles } from "@/lib/template";
import { RELATION_SLOT_COUNT, type Universe } from "@/lib/types";

function UniverseThumb({ universe }: { universe: Universe }) {
  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-card border border-border text-lg">
      {universe.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={universe.image}
          alt={universe.title}
          className="h-full w-full object-cover"
        />
      ) : universe.type === "org" ? (
        <GlobeIcon />
      ) : (
        <SparkleIcon />
      )}
    </div>
  );
}

export default function AuListPage() {
  const [universes, setUniverses] = useState<Universe[] | null>(null);
  const [error, setError] = useState("");
  const [addingSamples, setAddingSamples] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setUniverses(await getUniverses());
      } catch {
        setError("세계관 목록을 불러오지 못했어요. 새로고침해 주세요.");
      }
    })();
  }, []);

  const org = universes?.find((u) => u.type === "org");
  const aus = universes?.filter((u) => u.type === "au") ?? [];
  const existingTitles = new Set(aus.map((u) => u.title));
  const missingSamples = SAMPLE_AUS.filter((s) => !existingTitles.has(s.title));

  async function handleAddSamples() {
    setAddingSamples(true);
    setError("");
    try {
      for (const sample of missingSamples) {
        const now = Date.now();
        const universe: Universe = {
          id: crypto.randomUUID(),
          type: "au",
          title: sample.title,
          tagline: sample.tagline,
          tags: sample.tags,
          worldSetting: sample.worldSetting,
          faction: "",
          relations: Array(RELATION_SLOT_COUNT).fill(""),
          glossary: "",
          summary: "",
          image: moodPlaceholderImage(sample.moodColor, sample.moodEmoji),
          createdAt: now,
          updatedAt: now,
        };
        await saveUniverse(universe);
      }
      setUniverses(await getUniverses());
    } catch (err) {
      setError(
        err instanceof StorageError
          ? err.message
          : "예시 AU를 추가하지 못했어요. 잠시 후 다시 시도해 주세요."
      );
    } finally {
      setAddingSamples(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-4 pt-5 pb-3">
        <h1 className="text-xl font-bold">세계관</h1>
      </header>

      <main className="flex-1 px-4 pb-4">
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {org && (
          <Link
            href={`/au/${org.id}/edit`}
            className="glass mb-5 flex items-center gap-3 rounded-2xl p-3 transition-transform hover:-translate-y-0.5"
          >
            <UniverseThumb universe={org} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{org.title}</p>
              <p className="truncate text-sm text-muted">
                {org.summary || org.worldSetting || "기본 세계관 설정"}
              </p>
            </div>
            <span className="text-muted">
              <EditIcon />
            </span>
          </Link>
        )}

        <p className="mb-2 text-sm font-medium">AU</p>
        {aus.length === 0 ? (
          <p className="mb-4 text-sm text-muted">
            아직 만든 AU가 없어요. 아래에서 첫 AU를 만들어 보세요.
          </p>
        ) : (
          <ul className="mb-4 grid grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-3">
            {aus.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/au/${u.id}/edit`}
                  className="glass flex items-center gap-3 rounded-2xl p-3 transition-transform hover:-translate-y-0.5"
                >
                  <UniverseThumb universe={u} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{u.title}</p>
                    <p className="truncate text-sm text-muted">
                      {u.tagline || "소개가 없어요"}
                    </p>
                    {u.tags && u.tags.length > 0 && (
                      <p className="mt-1 truncate text-xs text-muted">
                        {u.tags.map((t) => `#${t}`).join(" ")}
                      </p>
                    )}
                    {hasUnresolvedRoles(u) && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
                        <WarningIcon /> 역할 배정이 필요해요
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {missingSamples.length > 0 && (
          <button
            type="button"
            onClick={handleAddSamples}
            disabled={addingSamples}
            className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-border bg-card py-3 text-sm font-medium transition-transform hover:scale-[1.01] active:scale-[0.98] disabled:opacity-60 disabled:hover:scale-100"
          >
            {addingSamples ? (
              "예시 AU 추가하는 중…"
            ) : (
              <>
                <SparkleIcon /> 예시 AU {missingSamples.length}개 추가하기
              </>
            )}
          </button>
        )}

        <Link
          href="/au/new"
          className="flex w-full items-center justify-center rounded-2xl border border-dashed border-border py-3 text-sm font-medium text-muted transition-transform hover:scale-[1.01] active:scale-[0.98]"
        >
          + AU 추가
        </Link>
      </main>

      <BottomNav />
    </div>
  );
}
