import type { Character } from "./types";

/** 역할 반전 설정(기본값)이 있으면 AI가 실제로 연기할 캐릭터를 돌려준다 */
export function resolveVoiceCharacter(base: Character, all: Character[]): Character {
  if (!base.aiVoiceCharacterId) return base;
  return all.find((c) => c.id === base.aiVoiceCharacterId) ?? base;
}

/**
 * 방 안에서 "지금 AI가 누구를 연기 중인지" 임시로 뒤바꾼 값(overrideId)이
 * 있으면 그걸 우선 쓰고, 없으면 캐릭터의 기본 역할 반전 설정을 따른다.
 * override는 카드에 미리 등록된 반전 대상뿐 아니라 어떤 캐릭터든 될 수
 * 있다(방 안에서 자유롭게 고를 수 있게). 존재하지 않는 id면 기본값으로
 * 되돌린다.
 */
export function resolveActiveVoiceCharacter(
  base: Character,
  all: Character[],
  overrideId: string | null
): Character {
  if (overrideId) {
    const found = all.find((c) => c.id === overrideId);
    if (found) return found;
  }
  return resolveVoiceCharacter(base, all);
}

/**
 * 지금 AI가 voiceCharacter를 연기하고 있을 때, 사용자가 입력하는 메시지는
 * 실제로 누가 하는 말로 취급되는지 돌려준다. 이 방에 반전 파트너가 아예
 * 없으면(=역할 반전 설정 자체가 없으면) null — 이름 없는 "사용자"로 취급된다.
 */
export function resolvePlayerCharacter(
  base: Character,
  all: Character[],
  voiceCharacter: Character
): Character | null {
  if (voiceCharacter.id !== base.id) return base;
  if (!base.aiVoiceCharacterId) return null;
  return all.find((c) => c.id === base.aiVoiceCharacterId) ?? null;
}
