// AU 세계관 텍스트에 쓰인 {{A}}, {{B}} 같은 역할 표시를
// 실제로 배정된 캐릭터 이름으로 바꾸는 유틸.
import type { Character, Universe } from "./types";

function resolveText(text: string, nameA?: string, nameB?: string): string {
  let result = text;
  if (nameA) result = result.split("{{A}}").join(nameA);
  if (nameB) result = result.split("{{B}}").join(nameB);
  return result;
}

/**
 * AU가 아니거나 역할이 배정되지 않았으면 원본을 그대로 반환한다.
 * 배정되어 있으면 세계관 텍스트 안의 {{A}}/{{B}}를 캐릭터 이름으로 바꾼
 * 새 Universe를 반환한다 (원본은 건드리지 않는다).
 */
export function resolveUniverseTemplate(
  universe: Universe,
  characters: Character[]
): Universe {
  if (universe.type !== "au") return universe;
  const nameA = universe.roleA
    ? characters.find((c) => c.id === universe.roleA)?.name
    : undefined;
  const nameB = universe.roleB
    ? characters.find((c) => c.id === universe.roleB)?.name
    : undefined;
  if (!nameA && !nameB) return universe;

  return {
    ...universe,
    tagline: universe.tagline
      ? resolveText(universe.tagline, nameA, nameB)
      : universe.tagline,
    worldSetting: resolveText(universe.worldSetting, nameA, nameB),
    faction: resolveText(universe.faction, nameA, nameB),
    relations: universe.relations.map((r) => resolveText(r, nameA, nameB)),
    glossary: resolveText(universe.glossary, nameA, nameB),
    summary: resolveText(universe.summary, nameA, nameB),
  };
}
