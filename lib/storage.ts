// 서버(Redis) 저장소를 호출하는 클라이언트 모듈.
// 다른 화면에서는 이 모듈의 함수만 통해 데이터를 읽고 쓰게 한다.

import type {
  Character,
  ChatMessage,
  ObservationSession,
  World,
} from "./types";

/** 서버와 통신하지 못했을 때 던지는 에러 */
export class StorageError extends Error {
  constructor(message = "저장소와 통신하지 못했어요. 인터넷 연결을 확인해 주세요.") {
    super(message);
    this.name = "StorageError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new StorageError();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new StorageError(
      typeof data.error === "string" ? data.error : undefined
    );
  }
  return data as T;
}

// ---------- 캐릭터 ----------

export async function getCharacters(): Promise<Character[]> {
  const data = await request<{ characters: Character[] }>(
    "/api/data/characters"
  );
  return data.characters;
}

export async function getCharacter(id: string): Promise<Character | undefined> {
  const characters = await getCharacters();
  return characters.find((c) => c.id === id);
}

export async function saveCharacter(character: Character): Promise<void> {
  await request("/api/data/characters", {
    method: "POST",
    body: JSON.stringify(character),
  });
}

export async function deleteCharacter(id: string): Promise<void> {
  await request(`/api/data/characters/${id}`, { method: "DELETE" });
}

// ---------- 세계관 ----------

export async function getWorld(): Promise<World> {
  return request<World>("/api/data/world");
}

export async function saveWorld(world: World): Promise<void> {
  await request("/api/data/world", {
    method: "POST",
    body: JSON.stringify(world),
  });
}

// ---------- 1:1 대화 기록 ----------

export async function getChatHistory(characterId: string): Promise<ChatMessage[]> {
  const data = await request<{ messages: ChatMessage[] }>(
    `/api/data/chat/${characterId}`
  );
  return data.messages;
}

export async function saveChatHistory(
  characterId: string,
  messages: ChatMessage[]
): Promise<void> {
  await request(`/api/data/chat/${characterId}`, {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
}

export async function clearChatHistory(characterId: string): Promise<void> {
  await request(`/api/data/chat/${characterId}`, { method: "DELETE" });
}

// ---------- 관찰 모드 세션 ----------

export async function getObservationSession(): Promise<ObservationSession | null> {
  const data = await request<{ session: ObservationSession | null }>(
    "/api/data/observation"
  );
  return data.session;
}

export async function saveObservationSession(
  session: ObservationSession
): Promise<void> {
  await request("/api/data/observation", {
    method: "POST",
    body: JSON.stringify(session),
  });
}

export async function clearObservationSession(): Promise<void> {
  await request("/api/data/observation", { method: "DELETE" });
}
