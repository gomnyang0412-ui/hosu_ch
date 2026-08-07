// localStorage 기반 저장 모듈.
// 나중에 서버 DB로 옮기게 되면 이 파일의 함수들만 API 호출로 바꾸면 되도록
// 다른 화면에서는 이 모듈의 함수만 통해 데이터를 읽고 쓰게 한다.

import type {
  Character,
  ChatMessage,
  ObservationSession,
  World,
} from "./types";

const KEYS = {
  characters: "cc_characters",
  world: "cc_world",
  chatPrefix: "cc_chat_",
  observation: "cc_observation",
} as const;

/** localStorage 저장 공간이 꽉 찼을 때 던지는 에러 */
export class StorageQuotaError extends Error {
  constructor() {
    super(
      "저장 공간이 가득 찼어요. 프로필 이미지나 대화 기록을 정리해 주세요."
    );
    this.name = "StorageQuotaError";
  }
}

function isBrowser() {
  return typeof window !== "undefined";
}

function safeGet<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    if (
      err instanceof DOMException &&
      (err.name === "QuotaExceededError" ||
        err.name === "NS_ERROR_DOM_QUOTA_REACHED")
    ) {
      throw new StorageQuotaError();
    }
    throw err;
  }
}

// ---------- 캐릭터 ----------

export function getCharacters(): Character[] {
  return safeGet<Character[]>(KEYS.characters, []);
}

export function getCharacter(id: string): Character | undefined {
  return getCharacters().find((c) => c.id === id);
}

export function saveCharacter(character: Character) {
  const list = getCharacters();
  const idx = list.findIndex((c) => c.id === character.id);
  if (idx >= 0) {
    list[idx] = character;
  } else {
    list.push(character);
  }
  safeSet(KEYS.characters, list);
}

export function deleteCharacter(id: string) {
  const list = getCharacters().filter((c) => c.id !== id);
  safeSet(KEYS.characters, list);
  clearChatHistory(id);
}

// ---------- 세계관 ----------

export function getWorld(): World {
  return safeGet<World>(KEYS.world, { worldSetting: "", relatedPeople: "" });
}

export function saveWorld(world: World) {
  safeSet(KEYS.world, world);
}

// ---------- 1:1 대화 기록 ----------

export function getChatHistory(characterId: string): ChatMessage[] {
  return safeGet<ChatMessage[]>(KEYS.chatPrefix + characterId, []);
}

export function saveChatHistory(characterId: string, messages: ChatMessage[]) {
  safeSet(KEYS.chatPrefix + characterId, messages);
}

export function clearChatHistory(characterId: string) {
  if (!isBrowser()) return;
  window.localStorage.removeItem(KEYS.chatPrefix + characterId);
}

// ---------- 관찰 모드 세션 ----------

export function getObservationSession(): ObservationSession | null {
  return safeGet<ObservationSession | null>(KEYS.observation, null);
}

export function saveObservationSession(session: ObservationSession) {
  safeSet(KEYS.observation, session);
}

export function clearObservationSession() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(KEYS.observation);
}
