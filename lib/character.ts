import type { Character } from "./types";

/** 역할 반전 설정이 있으면 AI가 실제로 연기할 캐릭터를 돌려준다 */
export function resolveVoiceCharacter(base: Character, all: Character[]): Character {
  if (!base.aiVoiceCharacterId) return base;
  return all.find((c) => c.id === base.aiVoiceCharacterId) ?? base;
}
