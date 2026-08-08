"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";
import { resizeImageFile } from "@/lib/image";
import {
  deleteUniverse,
  getCharacters,
  saveUniverse,
  StorageError,
} from "@/lib/storage";
import { RELATION_SLOT_COUNT, type Character, type Universe } from "@/lib/types";

function newAuDraft(): Universe {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    type: "au",
    title: "",
    tagline: "",
    tags: [],
    worldSetting: "",
    faction: "",
    relations: Array(RELATION_SLOT_COUNT).fill(""),
    glossary: "",
    summary: "",
    image: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export default function UniverseForm({ universe }: { universe?: Universe }) {
  const router = useRouter();
  const isNew = !universe;
  const base = universe ?? newAuDraft();
  const isOrg = base.type === "org";

  const [title, setTitle] = useState(base.title);
  const [tagline, setTagline] = useState(base.tagline ?? "");
  const [tagsText, setTagsText] = useState((base.tags ?? []).join(", "));
  const [worldSetting, setWorldSetting] = useState(base.worldSetting);
  const [faction, setFaction] = useState(base.faction);
  const [relations, setRelations] = useState<string[]>(base.relations);
  const [glossary, setGlossary] = useState(base.glossary);
  const [summary, setSummary] = useState(base.summary);
  const [image, setImage] = useState<string | undefined>(base.image);
  const [imageLoading, setImageLoading] = useState(false);
  const [roleA, setRoleA] = useState(base.roleA ?? "");
  const [roleB, setRoleB] = useState(base.roleB ?? "");
  const [error, setError] = useState("");

  const [characters, setCharacters] = useState<Character[]>([]);

  useEffect(() => {
    getCharacters()
      .then(setCharacters)
      .catch(() => {
        // 캐릭터 목록을 못 가져와도 폼 자체는 계속 쓸 수 있게 둔다
      });
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
    if (!isOrg && !title.trim()) {
      setError("AU 제목을 입력해 주세요.");
      return;
    }
    const next: Universe = {
      id: base.id,
      type: base.type,
      title: isOrg ? base.title : title.trim(),
      tagline: tagline.trim() || undefined,
      tags: tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      worldSetting,
      faction,
      relations,
      glossary,
      summary,
      image,
      roleA: roleA || undefined,
      roleB: roleB || undefined,
      createdAt: base.createdAt,
      updatedAt: Date.now(),
    };
    try {
      await saveUniverse(next);
      router.push("/au");
    } catch (err) {
      setError(
        err instanceof StorageError
          ? err.message
          : "저장 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요."
      );
    }
  }

  async function handleDelete() {
    if (isOrg) return;
    if (
      !window.confirm(
        `"${base.title || "이 AU"}"를 삭제할까요? 이 AU에서 나눈 대화 기록은 남지만 목록에서는 사라져요.`
      )
    ) {
      return;
    }
    try {
      await deleteUniverse(base.id);
      router.push("/au");
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
      <TopBar
        title={isOrg ? "오리지널 세계관" : isNew ? "AU 추가" : "AU 편집"}
      />

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        {isOrg && (
          <p className="text-sm text-muted">
            모든 캐릭터가 기본으로 살아가는 세계관이에요. AU를 만들면 같은
            캐릭터를 다른 설정으로도 즐길 수 있어요.
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">표지 이미지</span>
          <div className="flex items-center gap-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-card">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt={title || base.title}
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

        {!isOrg && (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">제목</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="AU 제목 (예: 친구에서 가이드로)"
                className="rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-foreground/30"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">한 줄 소개</span>
              <input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="목록 카드에 짧게 보여줄 소개 문구"
                className="rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-foreground/30"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">해시태그</span>
              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="쉼표로 구분해서 적어주세요 (예: 현대물, 소꿉친구)"
                className="rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-foreground/30"
              />
            </label>

            <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3">
              <span className="text-sm font-medium">역할 배정</span>
              <p className="text-xs text-muted">
                세계관 설정 속 {"{{A}}"}, {"{{B}}"}가 실제로 누구인지
                골라주세요. 대화·관찰을 시작하면 이름으로 바뀌어 들어가요.
              </p>
              {characters.length === 0 ? (
                <p className="text-xs text-muted">
                  아직 캐릭터가 없어요. 캐릭터 탭에서 먼저 추가해 주세요.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <span className="w-5 shrink-0 font-semibold">A</span>
                    <select
                      value={roleA}
                      onChange={(e) => setRoleA(e.target.value)}
                      className="flex-1 rounded-xl border border-border bg-background p-2.5 text-sm outline-none focus:border-foreground/30"
                    >
                      <option value="">선택 안 함</option>
                      {characters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="w-5 shrink-0 font-semibold">B</span>
                    <select
                      value={roleB}
                      onChange={(e) => setRoleB(e.target.value)}
                      className="flex-1 rounded-xl border border-border bg-background p-2.5 text-sm outline-none focus:border-foreground/30"
                    >
                      <option value="">선택 안 함</option>
                      {characters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </div>
          </>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">세계관</span>
          <textarea
            value={worldSetting}
            onChange={(e) => setWorldSetting(e.target.value)}
            placeholder={
              isOrg
                ? "캐릭터들이 살아가는 시대, 장소, 배경 등을 자유롭게 적어주세요."
                : "이 AU만의 시대, 장소, 배경을 적어주세요."
            }
            rows={8}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-foreground/30"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">파벌</span>
          <textarea
            value={faction}
            onChange={(e) => setFaction(e.target.value)}
            placeholder="조직, 가문, 그룹 등 파벌 구도를 적어주세요."
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
            placeholder="이 세계관만의 용어, 지명, 규칙 등을 적어주세요."
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

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={handleSave}
          className="mt-2 rounded-xl bg-foreground py-3 text-sm font-semibold text-background"
        >
          저장하기
        </button>

        {!isOrg && !isNew && (
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-xl border border-red-200 py-3 text-sm font-semibold text-red-600"
          >
            AU 삭제
          </button>
        )}

        {!isOrg && !isNew && (
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-semibold">이 AU로 즐기기</p>

            {characters.length === 0 ? (
              <p className="text-xs text-muted">
                아직 캐릭터가 없어요. 캐릭터 탭에서 먼저 추가해 주세요.
              </p>
            ) : roleA && roleB ? (
              <>
                <p className="text-xs text-muted">
                  역할 배정에 맞춰 바로 시작할 수 있어요.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/character/${roleA}/chat?universe=${base.id}`}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-sm"
                  >
                    A · {characters.find((c) => c.id === roleA)?.name}로 대화하기
                  </Link>
                  <Link
                    href={`/character/${roleB}/chat?universe=${base.id}`}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-sm"
                  >
                    B · {characters.find((c) => c.id === roleB)?.name}로 대화하기
                  </Link>
                </div>
                <Link
                  href={`/observe?universe=${base.id}`}
                  className="rounded-xl border border-border py-2.5 text-center text-sm font-semibold"
                >
                  이 AU로 관찰 모드 시작하기
                </Link>
              </>
            ) : (
              <>
                <p className="text-xs text-muted">
                  역할을 배정하면 여기서 바로 시작할 수 있어요. 지금은
                  캐릭터를 직접 골라 대화하거나, 관찰 모드에서 골라주세요.
                </p>
                <div className="flex flex-wrap gap-2">
                  {characters.map((c) => (
                    <Link
                      key={c.id}
                      href={`/character/${c.id}/chat?universe=${base.id}`}
                      className="rounded-full border border-border bg-background px-3 py-1.5 text-sm"
                    >
                      {c.name}
                    </Link>
                  ))}
                </div>
                <Link
                  href={`/observe?universe=${base.id}`}
                  className="rounded-xl border border-border py-2.5 text-center text-sm font-semibold"
                >
                  이 AU로 관찰 모드 시작하기
                </Link>
              </>
            )}
          </div>
        )}

        {!isNew && (
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-semibold">여러 캐릭터와 대화하기</p>
            <p className="text-xs text-muted">
              캐릭터 2명 이상을 모아 하나의 대화방을 만들어요. 대화하다가
              말 거는 상대를 바꿔도, 지금까지의 이야기를 모두가 기억해요.
            </p>
            {characters.length < 2 ? (
              <p className="text-xs text-muted">
                캐릭터가 2명 이상 있어야 만들 수 있어요.
              </p>
            ) : (
              <Link
                href={`/thread/new?universe=${base.id}`}
                className="rounded-xl border border-border py-2.5 text-center text-sm font-semibold"
              >
                + 새 대화방 만들기
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
