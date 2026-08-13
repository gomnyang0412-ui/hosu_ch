// Redis(Upstash) 기반 저장 로직. 이 파일은 서버(Route Handler)에서만 import한다.
import { Redis } from "@upstash/redis";
import {
  chatHistoryToRoom,
  roomItemsToChatMessages,
  threadToRoom,
} from "./roomBridge";
import { serializeThreadItems } from "./thread";
import {
  ORG_UNIVERSE_ID,
  RELATION_SLOT_COUNT,
  createOrgUniverse,
  type Character,
  type CharacterMemory,
  type ChatMessage,
  type FullExport,
  type MultiThread,
  type ObservationSession,
  type Room,
  type RoomSummary,
  type Universe,
} from "./types";

/** 데이터베이스 환경 변수가 아직 설정되지 않았을 때 던지는 에러 */
export class DbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbConfigError";
  }
}

let redis: Redis | null = null;

// Vercel의 Upstash 연동은 KV_REST_API_URL / KV_REST_API_TOKEN을,
// 직접 만든 Upstash 프로젝트는 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN을
// 쓴다. 두 이름을 모두 확인하고, 없으면 빌드 시점이 아니라 실제 호출 시점에
// (조용히 경고만 찍는 대신) 분명한 한국어 에러로 알려준다.
function getRedis(): Redis {
  if (!redis) {
    const url =
      process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token =
      process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new DbConfigError(
        "서버에 데이터베이스가 연결되어 있지 않아요. Vercel 프로젝트의 Storage 탭에서 Upstash Redis를 연결해 주세요."
      );
    }
    redis = new Redis({ url, token });
  }
  return redis;
}

const KEYS = {
  characters: "cc:characters",
  universes: "cc:universes",
  /** 예전 버전(단일 세계관)이 쓰던 키. ORG 마이그레이션에만 읽는다. */
  legacyWorld: "cc:world",
  /** 예전 버전(1:1 채팅 전용)이 쓰던 키. Room 마이그레이션에만 읽는다. */
  legacyChatPrefix: "cc:chat:",
  legacyChatVoicePrefix: "cc:chatvoice:",
  legacyChatPlayerPrefix: "cc:chatplayer:",
  /** 예전 버전(멀티 대화방 전용)이 쓰던 키. Room 마이그레이션에만 읽는다. */
  legacyThreadsPrefix: "cc:threads:",
  /** 예전 버전(유니버스당 진행 중인 이야기 1개)이 쓰던 키. 목록 형식 마이그레이션에만 읽는다. */
  observationPrefix: "cc:observation:",
  storiesPrefix: "cc:stories:",
  roomsPrefix: "cc:rooms:",
  memoryPrefix: "cc:memory:",
  backupPrefix: "cc:backup:",
} as const;

// 대화 기록처럼 "통째로 덮어쓰는" 저장은 실수(버그·오조작)로 기존 내용을
// 날려버릴 위험이 있다. 덮어쓰기 직전 값을 키별로 최근 몇 개만 남겨두면,
// 사고가 나도 직전 상태로 되돌릴 수 있다.
const BACKUP_KEEP = 5;

async function pushBackup(key: string, previousValue: unknown): Promise<void> {
  // 저장된 적이 없던 키(최초 저장)는 되돌릴 "이전 상태" 자체가 없다.
  if (previousValue === null || previousValue === undefined) return;
  const backupKey = `${KEYS.backupPrefix}${key}`;
  await getRedis().lpush(backupKey, { value: previousValue, ts: Date.now() });
  await getRedis().ltrim(backupKey, 0, BACKUP_KEEP - 1);
}

async function listBackups<T>(
  key: string
): Promise<{ value: T; ts: number }[]> {
  const raw = await getRedis().lrange<{ value: T; ts: number }>(
    `${KEYS.backupPrefix}${key}`,
    0,
    BACKUP_KEEP - 1
  );
  return raw ?? [];
}

function legacyChatKey(universeId: string, characterId: string) {
  return `${KEYS.legacyChatPrefix}${universeId}:${characterId}`;
}

function legacyOrgChatKey(characterId: string) {
  return `${KEYS.legacyChatPrefix}${characterId}`;
}

function legacyChatVoiceKey(universeId: string, characterId: string) {
  return `${KEYS.legacyChatVoicePrefix}${universeId}:${characterId}`;
}

function legacyChatPlayerKey(universeId: string, characterId: string) {
  return `${KEYS.legacyChatPlayerPrefix}${universeId}:${characterId}`;
}

function legacyThreadsKey(universeId: string) {
  return `${KEYS.legacyThreadsPrefix}${universeId}`;
}

function observationKey(universeId: string) {
  return `${KEYS.observationPrefix}${universeId}`;
}

function storiesKey(universeId: string) {
  return `${KEYS.storiesPrefix}${universeId}`;
}

function roomsKey(universeId: string) {
  return `${KEYS.roomsPrefix}${universeId}`;
}

function memoryKey(characterId: string) {
  return `${KEYS.memoryPrefix}${characterId}`;
}

function singleRoomId(characterId: string) {
  return `single-${characterId}`;
}

// ---------- 캐릭터 ----------

export async function getCharacters(): Promise<Character[]> {
  return (await getRedis().get<Character[]>(KEYS.characters)) ?? [];
}

export async function saveCharacters(characters: Character[]): Promise<void> {
  await getRedis().set(KEYS.characters, characters);
}

// ---------- 세계관(유니버스) ----------

function normalizeUniverse(raw: Record<string, unknown>): Universe {
  const rawRelations = Array.isArray(raw.relations)
    ? (raw.relations as unknown[]).map((r) => (typeof r === "string" ? r : ""))
    : [];
  const relations = Array.from(
    { length: RELATION_SLOT_COUNT },
    (_, i) => rawRelations[i] ?? ""
  );
  return {
    id: typeof raw.id === "string" ? raw.id : crypto.randomUUID(),
    type: raw.type === "org" ? "org" : "au",
    title: typeof raw.title === "string" ? raw.title : "",
    tagline: typeof raw.tagline === "string" ? raw.tagline : undefined,
    tags: Array.isArray(raw.tags)
      ? (raw.tags as unknown[]).filter((t): t is string => typeof t === "string")
      : [],
    worldSetting: typeof raw.worldSetting === "string" ? raw.worldSetting : "",
    faction: typeof raw.faction === "string" ? raw.faction : "",
    relations,
    glossary: typeof raw.glossary === "string" ? raw.glossary : "",
    summary: typeof raw.summary === "string" ? raw.summary : "",
    image: typeof raw.image === "string" ? raw.image : undefined,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}

/** ORG를 포함한 전체 세계관 목록을 반환한다. ORG는 항상 존재한다. */
export async function getUniverses(): Promise<Universe[]> {
  const raw = await getRedis().get<Record<string, unknown>[]>(KEYS.universes);
  if (raw && raw.length > 0) {
    return raw.map(normalizeUniverse);
  }

  // 예전 버전(단일 세계관)의 데이터가 있으면 ORG로 옮긴다.
  const legacy = await getRedis().get<Record<string, unknown>>(
    KEYS.legacyWorld
  );
  let org: Universe;
  if (legacy) {
    const rawRelations = Array.isArray(legacy.relations)
      ? (legacy.relations as unknown[]).map((r) =>
          typeof r === "string" ? r : ""
        )
      : [];
    const relations = Array.from(
      { length: RELATION_SLOT_COUNT },
      (_, i) => rawRelations[i] ?? ""
    );
    if (
      rawRelations.length === 0 &&
      typeof legacy.relatedPeople === "string" &&
      legacy.relatedPeople.trim()
    ) {
      relations[0] = legacy.relatedPeople;
    }
    org = {
      ...createOrgUniverse(),
      worldSetting:
        typeof legacy.worldSetting === "string" ? legacy.worldSetting : "",
      faction: typeof legacy.faction === "string" ? legacy.faction : "",
      relations,
      glossary: typeof legacy.glossary === "string" ? legacy.glossary : "",
      summary: typeof legacy.summary === "string" ? legacy.summary : "",
      image: typeof legacy.image === "string" ? legacy.image : undefined,
    };
  } else {
    org = createOrgUniverse();
  }

  const universes = [org];
  await getRedis().set(KEYS.universes, universes);
  return universes;
}

export async function getUniverse(id: string): Promise<Universe | undefined> {
  const universes = await getUniverses();
  return universes.find((u) => u.id === id);
}

/** 세계관 하나를 만들거나 덮어쓴다 (id가 같으면 수정) */
export async function saveUniverse(universe: Universe): Promise<void> {
  const universes = await getUniverses();
  const idx = universes.findIndex((u) => u.id === universe.id);
  if (idx >= 0) {
    universes[idx] = universe;
  } else {
    universes.push(universe);
  }
  await getRedis().set(KEYS.universes, universes);
}

/** AU 하나를 삭제한다 (ORG는 호출부에서 막는다) */
export async function deleteUniverse(id: string): Promise<void> {
  const universes = await getUniverses();
  await getRedis().set(
    KEYS.universes,
    universes.filter((u) => u.id !== id)
  );
  await getRedis().del(observationKey(id));
  await getRedis().del(storiesKey(id));
  await getRedis().del(roomsKey(id));
}

// ---------- 대화방(Room) — 1:1 채팅과 멀티 대화방 통합 ----------

/**
 * 예전 1:1 채팅 데이터를 원시 Redis 키에서 직접 읽는다. getRooms()의
 * 마이그레이션에서만 쓴다 — 새로 만드는 코드는 항상 Room을 통해서만
 * 대화 기록에 접근해야 한다.
 */
async function readLegacyChatHistory(
  universeId: string,
  characterId: string
): Promise<ChatMessage[]> {
  const existing = await getRedis().get<ChatMessage[]>(
    legacyChatKey(universeId, characterId)
  );
  if (existing) return existing;
  if (universeId === ORG_UNIVERSE_ID) {
    // 예전 버전(유니버스 구분이 없던 시절)의 대화 기록도 챙긴다.
    const legacy = await getRedis().get<ChatMessage[]>(
      legacyOrgChatKey(characterId)
    );
    if (legacy) return legacy;
  }
  return [];
}

/**
 * 유니버스 하나의 모든 대화방을 Room[]로 반환한다. 저장된 적이 없으면
 * (cc:rooms:{universeId} 키가 아직 없으면) 예전 1:1 채팅(cc:chat:*)과
 * 예전 멀티 대화방(cc:threads:{universeId})을 한 번만 자동으로 읽어와
 * Room으로 합친 뒤 새 키에 저장한다 — 관찰 모드 이야기 목록화 때 쓴
 * 것과 같은 "첫 읽기 시 자동·지연·멱등 마이그레이션" 패턴이다. 예전
 * 키들은 지우지 않고 그대로 둔다(유실 위험 0).
 */
export async function getRooms(universeId: string): Promise<Room[]> {
  const existing = await getRedis().get<Room[]>(roomsKey(universeId));
  if (existing) return existing;

  const [characters, legacyThreads] = await Promise.all([
    getCharacters(),
    getRedis().get<MultiThread[]>(legacyThreadsKey(universeId)),
  ]);

  const singleRooms = (
    await Promise.all(
      characters.map(async (c) => {
        const history = await readLegacyChatHistory(universeId, c.id);
        if (history.length === 0) return null;
        const [voice, player] = await Promise.all([
          getRedis().get<string>(legacyChatVoiceKey(universeId, c.id)),
          getRedis().get<string>(legacyChatPlayerKey(universeId, c.id)),
        ]);
        return chatHistoryToRoom(
          universeId,
          c.id,
          c.name,
          history,
          voice ?? null,
          player ?? null
        );
      })
    )
  ).filter((r): r is Room => r !== null);

  const groupRooms = (legacyThreads ?? []).map(threadToRoom);

  const migrated = [...singleRooms, ...groupRooms];
  if (migrated.length > 0) {
    await getRedis().set(roomsKey(universeId), migrated);
  }
  return migrated;
}

export async function getRoom(
  universeId: string,
  roomId: string
): Promise<Room | undefined> {
  const rooms = await getRooms(universeId);
  return rooms.find((r) => r.id === roomId);
}

/** 캐릭터 하나의 1:1 대화방을 찾는다 (id는 항상 `single-{characterId}`) */
export async function getRoomForCharacter(
  universeId: string,
  characterId: string
): Promise<Room | undefined> {
  return getRoom(universeId, singleRoomId(characterId));
}

/** 대화방 하나를 만들거나 덮어쓴다 (id가 같으면 수정). 방 하나당 백업 이력을 남긴다 */
export async function saveRoom(room: Room): Promise<void> {
  const rooms = await getRooms(room.universeId);
  const idx = rooms.findIndex((r) => r.id === room.id);
  await pushBackup(
    `${roomsKey(room.universeId)}:${room.id}`,
    idx >= 0 ? rooms[idx] : undefined
  );
  if (idx >= 0) {
    rooms[idx] = room;
  } else {
    rooms.push(room);
  }
  await getRedis().set(roomsKey(room.universeId), rooms);
}

export async function deleteRoom(
  universeId: string,
  roomId: string
): Promise<void> {
  const rooms = await getRooms(universeId);
  await getRedis().set(
    roomsKey(universeId),
    rooms.filter((r) => r.id !== roomId)
  );
}

/** 이 방의 최근 저장 이력(최대 5개, 최신순)을 돌려준다 */
export async function listRoomBackups(
  universeId: string,
  roomId: string
): Promise<{ value: Room; ts: number }[]> {
  return listBackups<Room>(`${roomsKey(universeId)}:${roomId}`);
}

/** 이 방을 이력 중 하나로 되돌린다. 되돌리기 직전 상태도 이력에 남긴다 */
export async function restoreRoomBackup(
  universeId: string,
  roomId: string,
  index: number
): Promise<Room | null> {
  const backups = await listRoomBackups(universeId, roomId);
  const target = backups[index];
  if (!target) return null;
  const rooms = await getRooms(universeId);
  const idx = rooms.findIndex((r) => r.id === roomId);
  await pushBackup(
    `${roomsKey(universeId)}:${roomId}`,
    idx >= 0 ? rooms[idx] : undefined
  );
  if (idx >= 0) {
    rooms[idx] = target.value;
  } else {
    rooms.push(target.value);
  }
  await getRedis().set(roomsKey(universeId), rooms);
  return target.value;
}

/** 캐릭터 삭제 시, 그 유니버스의 모든 그룹 대화방 참가자 목록에서 해당 캐릭터를 뺀다 */
async function removeCharacterFromRooms(
  universeId: string,
  characterId: string
): Promise<void> {
  const rooms = await getRooms(universeId);
  if (rooms.length === 0) return;
  const updated = rooms.map((r) =>
    r.kind === "group" && r.characterIds.includes(characterId)
      ? { ...r, characterIds: r.characterIds.filter((id) => id !== characterId) }
      : r
  );
  await getRedis().set(roomsKey(universeId), updated);
}

// ---------- 1:1 채팅 호환 함수 ----------
// Room 저장 위에 얇게 얹은 호환 계층. lib/memoryService.ts처럼 여전히
// ChatMessage[] 모양을 기대하는 서버 로직이 코드 수정 없이 계속 동작하게
// 해준다. 새 화면 코드는 이 함수들 대신 getRoom/saveRoom을 직접 쓴다.

export async function getChatHistory(
  universeId: string,
  characterId: string
): Promise<ChatMessage[]> {
  const room = await getRoomForCharacter(universeId, characterId);
  return room ? roomItemsToChatMessages(room.items) : [];
}

/** 캐릭터를 삭제할 때, 모든 세계관에 걸친 그 캐릭터의 대화 기록을 지운다 */
export async function clearChatHistoryEverywhere(
  characterId: string
): Promise<void> {
  const universes = await getUniverses();
  await Promise.all([
    ...universes.map((u) => deleteRoom(u.id, singleRoomId(characterId))),
    ...universes.map((u) => removeCharacterFromRooms(u.id, characterId)),
    getRedis().del(memoryKey(characterId)),
  ]);
}

// ---------- 캐릭터별 누적 기억 ----------

export async function getCharacterMemory(
  characterId: string
): Promise<CharacterMemory | null> {
  return (await getRedis().get<CharacterMemory>(memoryKey(characterId))) ?? null;
}

export async function saveCharacterMemory(
  memory: CharacterMemory
): Promise<void> {
  await getRedis().set(memoryKey(memory.characterId), memory);
}

// ---------- 관찰 모드 이야기 (유니버스별, 여러 편 저장) ----------

export async function getStories(
  universeId: string
): Promise<ObservationSession[]> {
  const stories = await getRedis().get<ObservationSession[]>(
    storiesKey(universeId)
  );
  if (stories) return stories;

  // 예전 버전(유니버스당 진행 중인 이야기 1개)에 남아있던 이야기가 있다면
  // 잃어버리지 않도록 목록의 첫 항목으로 옮겨온다.
  const legacy = await getRedis().get<ObservationSession>(
    observationKey(universeId)
  );
  if (legacy && Array.isArray(legacy.episodes) && legacy.episodes.length > 0) {
    const migrated: ObservationSession = {
      ...legacy,
      id: legacy.id ?? crypto.randomUUID(),
      universeId,
    };
    await getRedis().set(storiesKey(universeId), [migrated]);
    return [migrated];
  }
  return [];
}

export async function getStory(
  universeId: string,
  storyId: string
): Promise<ObservationSession | undefined> {
  const stories = await getStories(universeId);
  return stories.find((s) => s.id === storyId);
}

/** 이야기 하나를 만들거나 덮어쓴다 (id가 같으면 수정) */
export async function saveStory(story: ObservationSession): Promise<void> {
  const stories = await getStories(story.universeId);
  const key = storiesKey(story.universeId);
  const idx = stories.findIndex((s) => s.id === story.id);
  if (idx >= 0) {
    stories[idx] = story;
  } else {
    stories.push(story);
  }
  await getRedis().set(key, stories);
}

export async function deleteStory(
  universeId: string,
  storyId: string
): Promise<void> {
  const stories = await getStories(universeId);
  await getRedis().set(
    storiesKey(universeId),
    stories.filter((s) => s.id !== storyId)
  );
}

// ---------- 채팅 목록 (1:1 + 멀티 대화방 통합) ----------

/** 방 하나의 미리보기 텍스트. single 방은 마지막 AI 턴(같은 ts) 전체를,
 *  group 방은 마지막 아이템 하나만 보여준다 — 예전 ChatMessage 기반
 *  1:1과 ThreadItem 기반 멀티가 각각 보여주던 것과 동일하다. */
function roomPreview(room: Room): string {
  const last = room.items[room.items.length - 1];
  if (!last) return "";
  if (room.kind === "single" && last.t !== "u") {
    const turn = room.items.filter(
      (it) => it.ts === last.ts && it.t !== "u"
    );
    return serializeThreadItems(turn);
  }
  return serializeThreadItems([last]);
}

/** 기록이 있는 1:1 방 + 멀티 대화방을 전부 모아 최근 순으로 반환한다 */
export async function getRoomSummaries(): Promise<RoomSummary[]> {
  const [characters, universes] = await Promise.all([
    getCharacters(),
    getUniverses(),
  ]);

  const summaries: RoomSummary[] = [];

  await Promise.all(
    universes.map(async (u) => {
      const rooms = await getRooms(u.id);
      for (const room of rooms) {
        if (room.items.length === 0) continue;
        const names = room.characterIds
          .map((id) => characters.find((c) => c.id === id)?.name)
          .filter((n): n is string => !!n);
        if (room.kind === "single") {
          summaries.push({
            kind: "single",
            universeId: u.id,
            characterId: room.characterIds[0],
            title:
              u.type === "au" ? `${names[0] ?? ""} · ${u.title}` : names[0] ?? "",
            preview: roomPreview(room),
            updatedAt: room.updatedAt,
          });
        } else {
          summaries.push({
            kind: "group",
            universeId: u.id,
            threadId: room.id,
            title:
              (room.title?.trim() || names.join(" · ") || "대화방") +
              (u.type === "au" ? ` · ${u.title}` : ""),
            preview: roomPreview(room),
            updatedAt: room.updatedAt,
          });
        }
      }
    })
  );

  summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  return summaries;
}

export async function getAllData(): Promise<FullExport> {
  const [characters, universes] = await Promise.all([
    getCharacters(),
    getUniverses(),
  ]);

  const rooms = (
    await Promise.all(universes.map((u) => getRooms(u.id)))
  ).flat();

  const stories = (
    await Promise.all(universes.map((u) => getStories(u.id)))
  ).flat();

  const memories = (
    await Promise.all(characters.map((c) => getCharacterMemory(c.id)))
  ).filter((m): m is CharacterMemory => m !== null);

  return {
    exportedAt: Date.now(),
    characters,
    universes,
    rooms,
    stories,
    memories,
  };
}

/** 예전(rooms 통합 이전) 백업 파일 형식을 Room[]로 변환한다 */
function normalizeImportedRooms(data: FullExport): Room[] {
  if (Array.isArray(data.rooms)) return data.rooms;
  const chatRooms = (data.chats ?? []).map((c) => {
    const character = data.characters.find((ch) => ch.id === c.characterId);
    return chatHistoryToRoom(
      c.universeId,
      c.characterId,
      character?.name ?? "",
      c.history,
      c.voiceOverride,
      c.playerOverride
    );
  });
  const groupRooms = (data.threads ?? []).map(threadToRoom);
  return [...chatRooms, ...groupRooms];
}

/**
 * 내보내기 파일 하나로 지금 저장된 모든 데이터를 완전히 대체한다.
 * 백업 시점 이후에 생긴 데이터(백업에 없는 캐릭터·세계관·대화방 등)까지
 * 포함해서 "지금 있는 모든 것"을 지우고 백업 내용만 남기는 되돌리기
 * 전용 동작이다 — 부분 병합이 아니다. rooms 통합 이전의 예전 백업
 * 파일(chats+threads 형식)도 그대로 불러올 수 있다.
 */
export async function importAllData(data: FullExport): Promise<void> {
  const [oldCharacters, oldUniverses] = await Promise.all([
    getCharacters(),
    getUniverses(),
  ]);

  const allUniverseIds = new Set([
    ...oldUniverses.map((u) => u.id),
    ...data.universes.map((u) => u.id),
  ]);

  const importedRooms = normalizeImportedRooms(data);
  const roomsByUniverse = groupByUniverseId(importedRooms);

  await Promise.all([
    ...oldCharacters.map((c) => getRedis().del(memoryKey(c.id))),
    ...Array.from(allUniverseIds).flatMap((id) => [
      getRedis().del(roomsKey(id)),
      getRedis().del(storiesKey(id)),
      getRedis().del(observationKey(id)),
    ]),
  ]);

  await Promise.all([
    saveCharacters(data.characters),
    getRedis().set(KEYS.universes, data.universes),
    // 방이 하나도 없는 유니버스도 빈 배열을 명시적으로 써서, getRooms()가
    // 다시는 예전 레거시 키에서 마이그레이션을 시도하지 않게 한다.
    ...data.universes.map((u) =>
      getRedis().set(roomsKey(u.id), roomsByUniverse[u.id] ?? [])
    ),
    ...Object.entries(groupByUniverseId(data.stories ?? [])).map(
      ([universeId, list]) => getRedis().set(storiesKey(universeId), list)
    ),
    ...data.memories.map((m) => saveCharacterMemory(m)),
  ]);
}

function groupByUniverseId<T extends { universeId: string }>(
  list: T[]
): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of list) {
    (groups[item.universeId] ??= []).push(item);
  }
  return groups;
}
