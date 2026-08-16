// AU 세계관 텍스트에 쓰인 {{A}}, {{B}}, {{C}} 같은 역할 표시를
// 실제로 배정된 캐릭터 이름으로 바꾸는 유틸.
import type { Character, Universe } from "./types";

const TOKENS = ["{{A}}", "{{B}}", "{{C}}"] as const;
type Token = (typeof TOKENS)[number];

const ROLE_KEY: Record<Token, keyof Pick<Universe, "roleA" | "roleB" | "roleC">> = {
  "{{A}}": "roleA",
  "{{B}}": "roleB",
  "{{C}}": "roleC",
};

// 역할이 아직 배정되지 않았는데도 대화·관찰이 시작되면(예: 방금 추가한
// 예시 AU를 역할 배정 없이 바로 플레이하는 경우), 자리표시자를 원본
// 그대로("{{A}}는...") AI에게 보내는 대신 이 안전한 이름으로 대체한다 —
// 깨진 문법을 노출하지 않으면서도 뭔가 이상하다는 신호는 남긴다.
const FALLBACK_NAME: Record<Token, string> = {
  "{{A}}": "인물A",
  "{{B}}": "인물B",
  "{{C}}": "인물C",
};

function fieldsOf(universe: Universe): string[] {
  return [
    universe.tagline ?? "",
    universe.worldSetting,
    universe.faction,
    universe.glossary,
    universe.summary,
    ...universe.relations,
  ];
}

/** 이 AU 텍스트가 실제로 쓰는 토큰들(쓰지 않는 토큰은 검사할 필요가 없다) */
function usedTokens(universe: Universe): Token[] {
  const fields = fieldsOf(universe);
  return TOKENS.filter((t) => fields.some((f) => f.includes(t)));
}

/**
 * 이 AU 텍스트가 {{A}}/{{B}}/{{C}}를 쓰는데, 그중 아직 역할 배정이 안 된
 * 토큰이 있으면 true. UI에서 "역할 배정이 더 필요해요" 경고에 쓴다.
 */
export function hasUnresolvedRoles(universe: Universe): boolean {
  if (universe.type !== "au") return false;
  return usedTokens(universe).some((t) => !universe[ROLE_KEY[t]]);
}

function resolveText(text: string, names: Partial<Record<Token, string>>): string {
  let result = text;
  for (const token of TOKENS) {
    const name = names[token];
    if (!name && !result.includes(token)) continue;
    result = result.split(token).join(name ?? FALLBACK_NAME[token]);
  }
  return result;
}

/**
 * AU가 아니거나 이 AU 텍스트가 자리표시자를 하나도 안 쓰면 원본을 그대로
 * 반환한다. 자리표시자를 쓰면, 배정된 역할은 실제 캐릭터 이름으로,
 * 아직 배정 안 된 역할은 깨진 "{{A}}"가 그대로 노출되지 않도록 안전한
 * 대체 이름으로 바꾼 새 Universe를 반환한다(원본은 건드리지 않는다).
 */
export function resolveUniverseTemplate(
  universe: Universe,
  characters: Character[]
): Universe {
  if (universe.type !== "au") return universe;
  const tokens = usedTokens(universe);
  if (tokens.length === 0) return universe;

  const names: Partial<Record<Token, string>> = {};
  for (const token of tokens) {
    const roleId = universe[ROLE_KEY[token]];
    names[token] = roleId
      ? characters.find((c) => c.id === roleId)?.name
      : undefined;
  }

  return {
    ...universe,
    tagline: universe.tagline
      ? resolveText(universe.tagline, names)
      : universe.tagline,
    worldSetting: resolveText(universe.worldSetting, names),
    faction: resolveText(universe.faction, names),
    relations: universe.relations.map((r) => resolveText(r, names)),
    glossary: resolveText(universe.glossary, names),
    summary: resolveText(universe.summary, names),
  };
}
