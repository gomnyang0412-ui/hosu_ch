// 서버(Redis) 저장소를 호출하는 클라이언트 모듈.
// 다른 화면에서는 이 모듈의 함수만 통해 데이터를 읽고 쓰게 한다.

import { chatMessagesToRoomItems, roomItemsToChatMessages } from "./roomBridge";
import type {
  Character,
  ChatMessage,
  FullExport,
  ObservationSession,
  Room,
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

function singleRoomId(characterId: string) {
  return `single-${characterId}`;
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

// ---------- 대화방(Room) — 1:1 채팅과 멀티 대화방 통합 ----------

/** 한 유니버스의 모든 대화방(1:1 + 멀티) */
export async function listRooms(universeId: string): Promise<Room[]> {
  const data = await request<{ rooms: Room[] }>(`/api/data/rooms/${universeId}`);
  return data.rooms;
}

export async function getRoom(
  universeId: string,
  roomId: string
): Promise<Room | null> {
  const data = await request<{ room: Room | null }>(
    `/api/data/rooms/${universeId}/${roomId}`
  );
  return data.room;
}

/** 캐릭터 하나의 1:1 대화방을 찾는다 (id는 항상 `single-{characterId}`) */
export async function getRoomForCharacter(
  universeId: string,
  characterId: string
): Promise<Room | null> {
  return getRoom(universeId, singleRoomId(characterId));
}

export async function saveRoom(room: Room): Promise<void> {
  await request(`/api/data/rooms/${room.universeId}`, {
    method: "POST",
    body: JSON.stringify(room),
  });
}

export async function deleteRoom(
  universeId: string,
  roomId: string
): Promise<void> {
  await request(`/api/data/rooms/${universeId}/${roomId}`, {
    method: "DELETE",
  });
}

/** 이 방의 최근 저장 이력(최대 5개, 최신순) */
export async function getRoomBackups(
  universeId: string,
  roomId: string
): Promise<{ value: Room; ts: number }[]> {
  const data = await request<{ backups: { value: Room; ts: number }[] }>(
    `/api/data/rooms/${universeId}/${roomId}/backup`
  );
  return data.backups;
}

/** 이 방을 이력 중 하나로 되돌린다 */
export async function restoreRoomBackup(
  universeId: string,
  roomId: string,
  index: number
): Promise<Room> {
  const data = await request<{ room: Room }>(
    `/api/data/rooms/${universeId}/${roomId}/backup`,
    { method: "POST", body: JSON.stringify({ index }) }
  );
  return data.room;
}

// ---------- 1:1 채팅 호환 함수 ----------
// Room 저장 위에 얇게 얹은 호환 계층. CharacterForm의 "대화 참고해서
// 다듬기", 새 1:1 대화방 만들기 화면, 예전 localStorage 마이그레이션처럼
// 여전히 ChatMessage[]/개별 오버라이드 모양을 기대하는 코드가 수정 없이
// 계속 동작하게 해준다. 채팅 화면 자체는 이 함수들 대신 getRoom/saveRoom을
// 직접 쓴다.

async function getOrCreateSingleRoom(
  universeId: string,
  characterId: string
): Promise<Room> {
  const existing = await getRoom(universeId, singleRoomId(characterId));
  if (existing) return existing;
  const now = Date.now();
  return {
    id: singleRoomId(characterId),
    universeId,
    kind: "single",
    characterIds: [characterId],
    items: [],
    createdAt: now,
    updatedAt: now,
  };
}

export async function getChatHistory(
  universeId: string,
  characterId: string
): Promise<ChatMessage[]> {
  const room = await getRoom(universeId, singleRoomId(characterId));
  return room ? roomItemsToChatMessages(room.items) : [];
}

export async function saveChatHistory(
  universeId: string,
  characterId: string,
  messages: ChatMessage[]
): Promise<void> {
  const [room, character] = await Promise.all([
    getOrCreateSingleRoom(universeId, characterId),
    getCharacter(characterId),
  ]);
  await saveRoom({
    ...room,
    items: chatMessagesToRoomItems(messages, character?.name ?? ""),
    updatedAt: Date.now(),
  });
}

export async function clearChatHistory(
  universeId: string,
  characterId: string
): Promise<void> {
  const room = await getRoom(universeId, singleRoomId(characterId));
  if (!room) return;
  await saveRoom({ ...room, items: [], updatedAt: Date.now() });
}

/** 이 1:1 방에서 지금 AI가 누구를 연기 중인지(기본값을 임시로 뒤바꾼 값) */
export async function getChatVoiceOverride(
  universeId: string,
  characterId: string
): Promise<string | null> {
  const room = await getRoom(universeId, singleRoomId(characterId));
  return room?.aiVoiceOverrideId ?? null;
}

export async function saveChatVoiceOverride(
  universeId: string,
  characterId: string,
  voiceCharacterId: string | null
): Promise<void> {
  const room = await getOrCreateSingleRoom(universeId, characterId);
  await saveRoom({
    ...room,
    aiVoiceOverrideId: voiceCharacterId ?? undefined,
    updatedAt: Date.now(),
  });
}

/** 이 1:1 방에서 지금 내가 누구로 대화 중인지(AI 배역과 별개로 직접 고른 값) */
export async function getChatPlayerOverride(
  universeId: string,
  characterId: string
): Promise<string | null> {
  const room = await getRoom(universeId, singleRoomId(characterId));
  return room?.playerCharacterId ?? null;
}

export async function saveChatPlayerOverride(
  universeId: string,
  characterId: string,
  playerCharacterId: string | null
): Promise<void> {
  const room = await getOrCreateSingleRoom(universeId, characterId);
  await saveRoom({
    ...room,
    playerCharacterId: playerCharacterId ?? undefined,
    updatedAt: Date.now(),
  });
}

// ---------- 관찰 모드 이야기 (유니버스별, 여러 편 저장) ----------

export async function getStories(
  universeId: string
): Promise<ObservationSession[]> {
  const data = await request<{ stories: ObservationSession[] }>(
    `/api/data/stories/${universeId}`
  );
  return data.stories;
}

export async function getStory(
  universeId: string,
  storyId: string
): Promise<ObservationSession | null> {
  const data = await request<{ story: ObservationSession | null }>(
    `/api/data/stories/${universeId}/${storyId}`
  );
  return data.story;
}

export async function saveStory(story: ObservationSession): Promise<void> {
  await request(`/api/data/stories/${story.universeId}`, {
    method: "POST",
    body: JSON.stringify(story),
  });
}

export async function deleteStory(
  universeId: string,
  storyId: string
): Promise<void> {
  await request(`/api/data/stories/${universeId}/${storyId}`, {
    method: "DELETE",
  });
}

// ---------- 채팅 목록 (1:1 + 멀티 대화방 통합) ----------

export async function getRooms(): Promise<RoomSummary[]> {
  const data = await request<{ rooms: RoomSummary[] }>("/api/data/rooms");
  return data.rooms;
}

// ---------- 전체 데이터 내보내기/불러오기 ----------

export async function exportAllData(): Promise<FullExport> {
  return request<FullExport>("/api/data/export");
}

/** 내보내기 파일로 지금 저장된 모든 데이터를 완전히 대체한다 (되돌릴 수 없음) */
export async function importAllData(data: FullExport): Promise<void> {
  await request("/api/data/import", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
