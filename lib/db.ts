// Redis(Upstash) 기반 저장 로직. 이 파일은 서버(Route Handler)에서만 import한다.
import { Redis } from "@upstash/redis";
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
  chatPrefix: "cc:chat:",
  observationPrefix: "cc:observation:",
  threadsPrefix: "cc:threads:",
  memoryPrefix: "cc:memory:",
  chatVoicePrefix: "cc:chatvoice:",
  chatPlayerPrefix: "cc:chatplayer:",
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

function chatKey(universeId: string, characterId: string) {
  return `${KEYS.chatPrefix}${universeId}:${characterId}`;
}

function legacyChatKey(characterId: string) {
  return `${KEYS.chatPrefix}${characterId}`;
}

function observationKey(universeId: string) {
  return `${KEYS.observationPrefix}${universeId}`;
}

function threadsKey(universeId: string) {
  return `${KEYS.threadsPrefix}${universeId}`;
}

function memoryKey(characterId: string) {
  return `${KEYS.memoryPrefix}${characterId}`;
}

function chatVoiceKey(universeId: string, characterId: string) {
  return `${KEYS.chatVoicePrefix}${universeId}:${characterId}`;
}

function chatPlayerKey(universeId: string, characterId: string) {
  return `${KEYS.chatPlayerPrefix}${universeId}:${characterId}`;
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
  await getRedis().del(threadsKey(id));
}

// ---------- 1:1 대화 기록 (유니버스별) ----------

export async function getChatHistory(
  universeId: string,
  characterId: string
): Promise<ChatMessage[]> {
  const existing = await getRedis().get<ChatMessage[]>(
    chatKey(universeId, characterId)
  );
  if (existing) return existing;
  if (universeId === ORG_UNIVERSE_ID) {
    // 예전 버전(유니버스 구분이 없던 시절)의 대화 기록을 그대로 보여준다.
    // 다음에 저장되면 새 키로 옮겨진다.
    const legacy = await getRedis().get<ChatMessage[]>(
      legacyChatKey(characterId)
    );
    if (legacy) return legacy;
  }
  return [];
}

export async function saveChatHistory(
  universeId: string,
  characterId: string,
  messages: ChatMessage[]
): Promise<void> {
  const key = chatKey(universeId, characterId);
  const previous = await getRedis().get<ChatMessage[]>(key);
  await pushBackup(key, previous);
  await getRedis().set(key, messages);
}

/** 이 1:1 방의 최근 저장 이력(최대 5개, 최신순)을 돌려준다 */
export async function listChatHistoryBackups(
  universeId: string,
  characterId: string
): Promise<{ value: ChatMessage[]; ts: number }[]> {
  return listBackups<ChatMessage[]>(chatKey(universeId, characterId));
}

/** 이 1:1 방을 이력 중 하나로 되돌린다. 되돌리기 직전 상태도 이력에 남긴다 */
export async function restoreChatHistoryBackup(
  universeId: string,
  characterId: string,
  index: number
): Promise<ChatMessage[] | null> {
  const backups = await listChatHistoryBackups(universeId, characterId);
  const target = backups[index];
  if (!target) return null;
  const key = chatKey(universeId, characterId);
  const current = await getRedis().get<ChatMessage[]>(key);
  await pushBackup(key, current);
  await getRedis().set(key, target.value);
  return target.value;
}

export async function clearChatHistory(
  universeId: string,
  characterId: string
): Promise<void> {
  await getRedis().del(chatKey(universeId, characterId));
  if (universeId === ORG_UNIVERSE_ID) {
    await getRedis().del(legacyChatKey(characterId));
  }
}

/** 캐릭터를 삭제할 때, 모든 세계관에 걸친 그 캐릭터의 대화 기록을 지운다 */
export async function clearChatHistoryEverywhere(
  characterId: string
): Promise<void> {
  const universes = await getUniverses();
  await Promise.all([
    ...universes.map((u) => getRedis().del(chatKey(u.id, characterId))),
    getRedis().del(legacyChatKey(characterId)),
    ...universes.map((u) => removeCharacterFromThreads(u.id, characterId)),
    getRedis().del(memoryKey(characterId)),
    ...universes.map((u) => getRedis().del(chatVoiceKey(u.id, characterId))),
    ...universes.map((u) => getRedis().del(chatPlayerKey(u.id, characterId))),
  ]);
}

// ---------- 1:1 방 안에서 지금 AI가 누구를 연기 중인지(기본값 임시 덮어쓰기) ----------

export async function getChatVoiceOverride(
  universeId: string,
  characterId: string
): Promise<string | null> {
  return (
    (await getRedis().get<string>(chatVoiceKey(universeId, characterId))) ??
    null
  );
}

export async function saveChatVoiceOverride(
  universeId: string,
  characterId: string,
  voiceCharacterId: string | null
): Promise<void> {
  if (voiceCharacterId) {
    await getRedis().set(chatVoiceKey(universeId, characterId), voiceCharacterId);
  } else {
    await getRedis().del(chatVoiceKey(universeId, characterId));
  }
}

// ---------- 1:1 방 안에서 지금 내가 누구로 대화 중인지(AI 배역과 별개) ----------

export async function getChatPlayerOverride(
  universeId: string,
  characterId: string
): Promise<string | null> {
  return (
    (await getRedis().get<string>(chatPlayerKey(universeId, characterId))) ??
    null
  );
}

export async function saveChatPlayerOverride(
  universeId: string,
  characterId: string,
  playerCharacterId: string | null
): Promise<void> {
  if (playerCharacterId) {
    await getRedis().set(chatPlayerKey(universeId, characterId), playerCharacterId);
  } else {
    await getRedis().del(chatPlayerKey(universeId, characterId));
  }
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

// ---------- 관찰 모드 세션 (유니버스별) ----------

export async function getObservationSession(
  universeId: string
): Promise<ObservationSession | null> {
  const existing = await getRedis().get<ObservationSession>(
    observationKey(universeId)
  );
  if (existing) return existing;
  if (universeId === ORG_UNIVERSE_ID) {
    // 예전 버전(유니버스 구분이 없던 시절)의 관찰 세션을 그대로 보여준다.
    const legacy = await getRedis().get<Omit<ObservationSession, "universeId">>(
      "cc:observation"
    );
    if (legacy) return { ...legacy, universeId: ORG_UNIVERSE_ID };
  }
  return null;
}

export async function saveObservationSession(
  session: ObservationSession
): Promise<void> {
  await getRedis().set(observationKey(session.universeId), session);
}

export async function clearObservationSession(
  universeId: string
): Promise<void> {
  await getRedis().del(observationKey(universeId));
  if (universeId === ORG_UNIVERSE_ID) {
    await getRedis().del("cc:observation");
  }
}

// ---------- 멀티 캐릭터 대화방 (유니버스별, 여러 개 가능) ----------

export async function getThreads(universeId: string): Promise<MultiThread[]> {
  return (await getRedis().get<MultiThread[]>(threadsKey(universeId))) ?? [];
}

export async function getThread(
  universeId: string,
  threadId: string
): Promise<MultiThread | undefined> {
  const threads = await getThreads(universeId);
  return threads.find((t) => t.id === threadId);
}

/** 대화방 하나를 만들거나 덮어쓴다 (id가 같으면 수정) */
export async function saveThread(thread: MultiThread): Promise<void> {
  const threads = await getThreads(thread.universeId);
  const key = threadsKey(thread.universeId);
  await pushBackup(key, threads);
  const idx = threads.findIndex((t) => t.id === thread.id);
  if (idx >= 0) {
    threads[idx] = thread;
  } else {
    threads.push(thread);
  }
  await getRedis().set(key, threads);
}

export async function deleteThread(
  universeId: string,
  threadId: string
): Promise<void> {
  const threads = await getThreads(universeId);
  await getRedis().set(
    threadsKey(universeId),
    threads.filter((t) => t.id !== threadId)
  );
}

/** 캐릭터 삭제 시, 그 유니버스의 모든 대화방 참가자 목록에서 해당 캐릭터를 뺀다 */
async function removeCharacterFromThreads(
  universeId: string,
  characterId: string
): Promise<void> {
  const threads = await getThreads(universeId);
  if (threads.length === 0) return;
  const updated = threads.map((t) =>
    t.characterIds.includes(characterId)
      ? { ...t, characterIds: t.characterIds.filter((id) => id !== characterId) }
      : t
  );
  await getRedis().set(threadsKey(universeId), updated);
}

// ---------- 채팅 목록 (1:1 + 멀티 대화방 통합) ----------

/** 기록이 있는 1:1 방 + 멀티 대화방을 전부 모아 최근 순으로 반환한다 */
export async function getRoomSummaries(): Promise<RoomSummary[]> {
  const [characters, universes] = await Promise.all([
    getCharacters(),
    getUniverses(),
  ]);

  const rooms: RoomSummary[] = [];

  await Promise.all(
    universes.flatMap((u) =>
      characters.map(async (c) => {
        const history = await getChatHistory(u.id, c.id);
        if (history.length === 0) return;
        const last = history[history.length - 1];
        rooms.push({
          kind: "single",
          universeId: u.id,
          characterId: c.id,
          title: u.type === "au" ? `${c.name} · ${u.title}` : c.name,
          preview: last.text,
          updatedAt: last.ts,
        });
      })
    )
  );

  await Promise.all(
    universes.map(async (u) => {
      const threads = await getThreads(u.id);
      for (const t of threads) {
        if (t.items.length === 0) continue;
        const names = t.characterIds
          .map((id) => characters.find((c) => c.id === id)?.name)
          .filter((n): n is string => !!n);
        rooms.push({
          kind: "group",
          universeId: u.id,
          threadId: t.id,
          title:
            (t.title?.trim() || names.join(" · ") || "대화방") +
            (u.type === "au" ? ` · ${u.title}` : ""),
          preview: serializeThreadItems([t.items[t.items.length - 1]]),
          updatedAt: t.updatedAt,
        });
      }
    })
  );

  rooms.sort((a, b) => b.updatedAt - a.updatedAt);
  return rooms;
}

export async function getAllData(): Promise<FullExport> {
  const [characters, universes] = await Promise.all([
    getCharacters(),
    getUniverses(),
  ]);

  const chats = (
    await Promise.all(
      universes.flatMap((u) =>
        characters.map(async (c) => {
          const [history, voiceOverride, playerOverride] = await Promise.all([
            getChatHistory(u.id, c.id),
            getChatVoiceOverride(u.id, c.id),
            getChatPlayerOverride(u.id, c.id),
          ]);
          if (history.length === 0) return null;
          return {
            universeId: u.id,
            characterId: c.id,
            history,
            voiceOverride,
            playerOverride,
          };
        })
      )
    )
  ).filter((c): c is NonNullable<typeof c> => c !== null);

  const threads = (
    await Promise.all(universes.map((u) => getThreads(u.id)))
  ).flat();

  const memories = (
    await Promise.all(characters.map((c) => getCharacterMemory(c.id)))
  ).filter((m): m is CharacterMemory => m !== null);

  return {
    exportedAt: Date.now(),
    characters,
    universes,
    chats,
    threads,
    memories,
  };
}
