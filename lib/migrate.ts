// 예전 버전(브라우저 localStorage 저장 방식)에 남아있던 데이터를
// 서버가 비어있을 때 한 번만 서버로 옮기는 마이그레이션.
import { getCharacters, saveCharacter, saveChatHistory, saveWorld, saveObservationSession } from "./storage";
import type { Character, ChatMessage, ObservationSession, World } from "./types";

const OLD_KEYS = {
  characters: "cc_characters",
  world: "cc_world",
  chatPrefix: "cc_chat_",
  observation: "cc_observation",
} as const;

function readLocal<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** 로컬에 남은 예전 데이터가 있고 서버가 비어있으면 서버로 올린다 */
export async function migrateFromLocalStorageIfNeeded(): Promise<void> {
  if (typeof window === "undefined") return;

  const localCharacters = readLocal<Character[]>(OLD_KEYS.characters);
  if (!localCharacters || localCharacters.length === 0) return;

  let serverCharacters: Character[];
  try {
    serverCharacters = await getCharacters();
  } catch {
    return; // 서버 상태를 확인할 수 없으면 이번엔 건너뛰고 다음에 다시 시도한다
  }
  if (serverCharacters.length > 0) return; // 이미 서버에 데이터가 있으면 건너뛴다

  try {
    for (const character of localCharacters) {
      await saveCharacter(character);
      const messages = readLocal<ChatMessage[]>(
        OLD_KEYS.chatPrefix + character.id
      );
      if (messages && messages.length > 0) {
        await saveChatHistory(character.id, messages);
      }
    }

    const world = readLocal<World>(OLD_KEYS.world);
    if (world) {
      await saveWorld(world);
    }

    const observation = readLocal<ObservationSession>(OLD_KEYS.observation);
    if (observation) {
      await saveObservationSession(observation);
    }
  } catch {
    // 일부만 옮겨졌더라도 로컬 데이터는 그대로 남아있으니 다음에 다시 시도된다
  }
}
