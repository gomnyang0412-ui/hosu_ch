// 서버(Redis) 저장소를 호출하는 클라이언트 모듈.
// 다른 화면에서는 이 모듈의 함수만 통해 데이터를 읽고 쓰게 한다.

import type {
  Character,
  ChatMessage,
  MultiThread,
  ObservationSession,
  RoomSummary,
  Universe,
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

// ---------- 세계관(유니버스) ----------

export async function getUniverses(): Promise<Universe[]> {
  const data = await request<{ universes: Universe[] }>(
    "/api/data/universes"
  );
  return data.universes;
}

export async function getUniverse(id: string): Promise<Universe | undefined> {
  const universes = await getUniverses();
  return universes.find((u) => u.id === id);
}

export async function saveUniverse(universe: Universe): Promise<void> {
  await request("/api/data/universes", {
    method: "POST",
    body: JSON.stringify(universe),
  });
}

export async function deleteUniverse(id: string): Promise<void> {
  await request(`/api/data/universes/${id}`, { method: "DELETE" });
}

// ---------- 1:1 대화 기록 ----------

export async function getChatHistory(
  universeId: string,
  characterId: string
): Promise<ChatMessage[]> {
  const data = await request<{ messages: ChatMessage[] }>(
    `/api/data/chat/${universeId}/${characterId}`
  );
  return data.messages;
}

export async function saveChatHistory(
  universeId: string,
  characterId: string,
  messages: ChatMessage[]
): Promise<void> {
  await request(`/api/data/chat/${universeId}/${characterId}`, {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
}

export async function clearChatHistory(
  universeId: string,
  characterId: string
): Promise<void> {
  await request(`/api/data/chat/${universeId}/${characterId}`, {
    method: "DELETE",
  });
}

/** 이 1:1 방에서 지금 AI가 누구를 연기 중인지(기본값을 임시로 뒤바꾼 값) */
export async function getChatVoiceOverride(
  universeId: string,
  characterId: string
): Promise<string | null> {
  const data = await request<{ voiceCharacterId: string | null }>(
    `/api/data/chat-voice/${universeId}/${characterId}`
  );
  return data.voiceCharacterId;
}

export async function saveChatVoiceOverride(
  universeId: string,
  characterId: string,
  voiceCharacterId: string | null
): Promise<void> {
  await request(`/api/data/chat-voice/${universeId}/${characterId}`, {
    method: "POST",
    body: JSON.stringify({ voiceCharacterId }),
  });
}

/** 이 1:1 방에서 지금 내가 누구로 대화 중인지(AI 배역과 별개로 직접 고른 값) */
export async function getChatPlayerOverride(
  universeId: string,
  characterId: string
): Promise<string | null> {
  const data = await request<{ playerCharacterId: string | null }>(
    `/api/data/chat-player/${universeId}/${characterId}`
  );
  return data.playerCharacterId;
}

export async function saveChatPlayerOverride(
  universeId: string,
  characterId: string,
  playerCharacterId: string | null
): Promise<void> {
  await request(`/api/data/chat-player/${universeId}/${characterId}`, {
    method: "POST",
    body: JSON.stringify({ playerCharacterId }),
  });
}

// ---------- 관찰 모드 세션 ----------

export async function getObservationSession(
  universeId: string
): Promise<ObservationSession | null> {
  const data = await request<{ session: ObservationSession | null }>(
    `/api/data/observation/${universeId}`
  );
  return data.session;
}

export async function saveObservationSession(
  session: ObservationSession
): Promise<void> {
  await request(`/api/data/observation/${session.universeId}`, {
    method: "POST",
    body: JSON.stringify(session),
  });
}

export async function clearObservationSession(
  universeId: string
): Promise<void> {
  await request(`/api/data/observation/${universeId}`, { method: "DELETE" });
}

// ---------- 멀티 캐릭터 대화방 ----------

export async function getThreads(universeId: string): Promise<MultiThread[]> {
  const data = await request<{ threads: MultiThread[] }>(
    `/api/data/threads/${universeId}`
  );
  return data.threads;
}

export async function getThread(
  universeId: string,
  threadId: string
): Promise<MultiThread | null> {
  const data = await request<{ thread: MultiThread | null }>(
    `/api/data/threads/${universeId}/${threadId}`
  );
  return data.thread;
}

export async function saveThread(thread: MultiThread): Promise<void> {
  await request(`/api/data/threads/${thread.universeId}`, {
    method: "POST",
    body: JSON.stringify(thread),
  });
}

export async function deleteThread(
  universeId: string,
  threadId: string
): Promise<void> {
  await request(`/api/data/threads/${universeId}/${threadId}`, {
    method: "DELETE",
  });
}

// ---------- 채팅 목록 (1:1 + 멀티 대화방 통합) ----------

export async function getRooms(): Promise<RoomSummary[]> {
  const data = await request<{ rooms: RoomSummary[] }>("/api/data/rooms");
  return data.rooms;
}
