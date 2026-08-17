"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";
import { WarningIcon } from "@/components/icons";
import { resizeImageFile } from "@/lib/image";
import {
  deleteUniverse,
  getCharacters,
  saveUniverse,
  storageErrorMessage,
} from "@/lib/storage";
import { hasUnresolvedRoles } from "@/lib/template";
import { RELATION_SLOT_COUNT, type Character, type Universe } from "@/lib/types";

type RoleLetter = "A" | "B" | "C";

/** 관계 칸 앞쪽 3개는 이 순서대로 역할 쌍(A-B, A-C, B-C)에 대응시킨다 */
const ROLE_PAIRS: readonly (readonly [RoleLetter, RoleLetter])[] = [
  ["A", "B"],
  ["A", "C"],
  ["B", "C"],
];

/**
 * 캐릭터의 기존 연관 인물/애정 관계 텍스트에서, 지금 짝지어진 상대의
 * 이름이 실제로 언급된 문장만 골라 참고용 문구로 만든다. 그 캐릭터의
 * 연관 인물 칸엔 이 AU에 없는 다른 사람 얘기도 섞여 있을 수 있어서,
 * 전체를 그대로 보여주면 오히려 헷갈린다 — 이름이 안 걸리면 아예
 * 보여주지 않는다(엉뚱한 내용을 참고라고 내미는 것보다 낫다).
 */
function referenceHint(c: Character, otherName: string): string {
  const combined = [c.relatedCharacters, c.romance]
    .filter((t) => t?.trim())
    .join(". ");
  const mentions = combined
    .split(/[.\n]/)
    .map((s) => s.trim())
    .filter((s) => s && s.includes(otherName));
  const text = mentions.join(". ").trim();
  return text.length > 100 ? `${text.slice(0, 100)}…` : text;
}

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
  const [roleC, setRoleC] = useState(base.roleC ?? "");
  const [error, setError] = useState("");

  const [characters, setCharacters] = useState<Character[]>([]);

  // 지금 입력 중인 값 기준으로 "{{A}}/{{B}}/{{C}}를 쓰는데 아직 역할을
  // 다 안 골랐는지" 매 렌더마다 다시 확인한다 — 저장 전에도 경고를
  // 볼 수 있어야 한다.
  const draft: Universe = {
    ...base,
    tagline,
    worldSetting,
    faction,
    relations,
    glossary,
    summary,
    roleA: roleA || undefined,
    roleB: roleB || undefined,
    roleC: roleC || undefined,
  };
  const rolesNeeded = !isOrg && hasUnresolvedRoles(draft);

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
      roleC: roleC || undefined,
      createdAt: base.createdAt,
      updatedAt: Date.now(),
    };
    try {
      await saveUniverse(next);
      router.push("/au");
    } catch (err) {
      setError(
        storageErrorMessage(err, "저장 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.")
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
        storageErrorMessage(err, "삭제 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.")
      );
    }
  }

  function roleCharacter(letter: RoleLetter): Character | undefined {
    const id = letter === "A" ? roleA : letter === "B" ? roleB : roleC;
    return id ? characters.find((c) => c.id === id) : undefined;
  }

  // 관계 칸을 캐릭터 설정에서 뽑아올 수 있는 만큼만 보여준다 — 배정된
  // 역할 쌍이 있으면 실제 이름으로 라벨링하고, 각자의 기존 연관
  // 인물/애정 관계를 참고 문구로 붙인다. 예전에 자유롭게 쓰던 칸에
  // 이미 내용이 있으면(역할 쌍과 안 맞는 위치라도) 유실 없이 계속
  // 보여준다.
  const relationSlots = relations
    .map((value, i) => {
      const pair = ROLE_PAIRS[i];
      const charA = pair ? roleCharacter(pair[0]) : undefined;
      const charB = pair ? roleCharacter(pair[1]) : undefined;
      if (charA && charB) {
        return {
          index: i,
          label: `${charA.name}-${charB.name} 관계`,
          hints: [
            referenceHint(charA, charB.name) &&
              `${charA.name}: ${referenceHint(charA, charB.name)}`,
            referenceHint(charB, charA.name) &&
              `${charB.name}: ${referenceHint(charB, charA.name)}`,
          ].filter(Boolean) as string[],
        };
      }
      if (value.trim()) {
        return { index: i, label: `관계 ${i + 1}`, hints: [] as string[] };
      }
      return null;
    })
    .filter((slot): slot is NonNullable<typeof slot> => slot !== null);

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
                className="rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-primary/50"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">한 줄 소개</span>
              <input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="목록 카드에 짧게 보여줄 소개 문구"
                className="rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-primary/50"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">해시태그</span>
              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="쉼표로 구분해서 적어주세요 (예: 현대물, 소꿉친구)"
                className="rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-primary/50"
              />
            </label>

            <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3">
              <span className="text-sm font-medium">역할 배정</span>
              <p className="text-xs text-muted">
                세계관 설정 속 {"{{A}}"}, {"{{B}}"}, {"{{C}}"}가 실제로
                누구인지 골라주세요. 대화·관찰을 시작하면 이름으로 바뀌어
                들어가요. 2인 관계 AU는 A/B만, 3인 이상 얽히는 AU는 C까지
                써주세요.
              </p>
              {rolesNeeded && (
                <p className="flex items-start gap-1.5 rounded-xl bg-red-50 px-2.5 py-2 text-xs text-red-700">
                  <WarningIcon className="mt-0.5 shrink-0" /> 이 세계관 텍스트가
                  아직 배정 안 된 역할 표시를 쓰고 있어요. 배정하기 전까지는
                  안전한 임시 이름(인물A 등)으로 대신 나가요.
                </p>
              )}
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
                      className="flex-1 rounded-xl border border-border bg-background p-2.5 text-sm outline-none focus:border-primary/50"
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
                      className="flex-1 rounded-xl border border-border bg-background p-2.5 text-sm outline-none focus:border-primary/50"
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
                    <span className="w-5 shrink-0 font-semibold">C</span>
                    <select
                      value={roleC}
                      onChange={(e) => setRoleC(e.target.value)}
                      className="flex-1 rounded-xl border border-border bg-background p-2.5 text-sm outline-none focus:border-primary/50"
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
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">파벌</span>
          <textarea
            value={faction}
            onChange={(e) => setFaction(e.target.value)}
            placeholder="조직, 가문, 그룹 등 파벌 구도를 적어주세요."
            rows={5}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
        </label>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">관계</p>
          {relationSlots.length === 0 ? (
            <p className="text-xs text-muted">
              역할을 2명 이상 배정하면, 그 사이 관계를 적을 수 있는 칸이
              여기 자동으로 생겨요.
            </p>
          ) : (
            relationSlots.map((slot) => (
              <label key={slot.index} className="flex flex-col gap-1.5">
                <span className="text-xs text-muted">{slot.label}</span>
                {slot.hints.length > 0 && (
                  <p className="rounded-lg bg-background px-2.5 py-1.5 text-[11px] leading-relaxed text-muted">
                    참고(기존 설정) · {slot.hints.join(" · ")}
                  </p>
                )}
                <textarea
                  value={relations[slot.index]}
                  onChange={(e) => updateRelation(slot.index, e.target.value)}
                  placeholder="이 AU에서는 원래 관계가 어떻게 달라지는지 적어주세요."
                  rows={3}
                  className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
                />
              </label>
            ))
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">용어 및 설정 사전</span>
          <textarea
            value={glossary}
            onChange={(e) => setGlossary(e.target.value)}
            placeholder="이 세계관만의 용어, 지명, 규칙 등을 적어주세요."
            rows={5}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">한 줄 요약</span>
          <p className="-mt-1 text-xs text-muted">
            위 세계관 내용을 다시 풀어 쓰지 말고, 무드나 후킹 포인트를
            한두 문장으로만 적어주세요. 목록 미리보기에도 쓰여요.
          </p>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="예: 서로를 지키려다 서로를 다치게 하는 사람들의 이야기"
            rows={2}
            className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={handleSave}
          className="mt-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
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
            ) : roleA || roleB || roleC ? (
              <>
                <p className="text-xs text-muted">
                  역할 배정에 맞춰 바로 시작할 수 있어요.
                </p>
                <div className="flex flex-wrap gap-2">
                  {([
                    ["A", roleA],
                    ["B", roleB],
                    ["C", roleC],
                  ] as const)
                    .filter(([, id]) => id)
                    .map(([label, id]) => (
                      <Link
                        key={label}
                        href={`/character/${id}/chat?universe=${base.id}`}
                        className="rounded-full border border-border bg-background px-3 py-1.5 text-sm"
                      >
                        {label} · {characters.find((c) => c.id === id)?.name}로 대화하기
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
