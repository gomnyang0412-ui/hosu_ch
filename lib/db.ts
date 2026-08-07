// Redis(Upstash) 기반 저장 로직. 이 파일은 서버(Route Handler)에서만 import한다.
import { Redis } from "@upstash/redis";
import {
  RELATION_SLOT_COUNT,
  emptyWorld,
  type Character,
  type ChatMessage,
  type ObservationSession,
  type World,
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
  world: "cc:world",
  chatPrefix: "cc:chat:",
  observation: "cc:observation",
} as const;

// ---------- 캐릭터 ----------

export async function getCharacters(): Promise<Character[]> {
  return (await getRedis().get<Character[]>(KEYS.characters)) ?? [];
}

export async function saveCharacters(characters: Character[]): Promise<void> {
  await getRedis().set(KEYS.characters, characters);
}

// ---------- 세계관 ----------

export async function getWorld(): Promise<World> {
  const raw = await getRedis().get<Record<string, unknown>>(KEYS.world);
  if (!raw) return emptyWorld();

  // 예전 버전(worldSetting + relatedPeople만 있던 시절)의 데이터를
  // 새 구조로 옮긴다. relatedPeople에 있던 내용은 "관계 1"로 이어진다.
  const rawRelations = Array.isArray(raw.relations)
    ? (raw.relations as unknown[]).map((r) => (typeof r === "string" ? r : ""))
    : [];
  const relations = Array.from(
    { length: RELATION_SLOT_COUNT },
    (_, i) => rawRelations[i] ?? ""
  );
  if (
    rawRelations.length === 0 &&
    typeof raw.relatedPeople === "string" &&
    raw.relatedPeople.trim()
  ) {
    relations[0] = raw.relatedPeople;
  }

  return {
    worldSetting: typeof raw.worldSetting === "string" ? raw.worldSetting : "",
    faction: typeof raw.faction === "string" ? raw.faction : "",
    relations,
    glossary: typeof raw.glossary === "string" ? raw.glossary : "",
    summary: typeof raw.summary === "string" ? raw.summary : "",
    image: typeof raw.image === "string" ? raw.image : undefined,
  };
}

export async function saveWorld(world: World): Promise<void> {
  await getRedis().set(KEYS.world, world);
}

// ---------- 1:1 대화 기록 ----------

export async function getChatHistory(
  characterId: string
): Promise<ChatMessage[]> {
  return (
    (await getRedis().get<ChatMessage[]>(KEYS.chatPrefix + characterId)) ?? []
  );
}

export async function saveChatHistory(
  characterId: string,
  messages: ChatMessage[]
): Promise<void> {
  await getRedis().set(KEYS.chatPrefix + characterId, messages);
}

export async function clearChatHistory(characterId: string): Promise<void> {
  await getRedis().del(KEYS.chatPrefix + characterId);
}

// ---------- 관찰 모드 세션 ----------

export async function getObservationSession(): Promise<ObservationSession | null> {
  return (await getRedis().get<ObservationSession>(KEYS.observation)) ?? null;
}

export async function saveObservationSession(
  session: ObservationSession
): Promise<void> {
  await getRedis().set(KEYS.observation, session);
}

export async function clearObservationSession(): Promise<void> {
  await getRedis().del(KEYS.observation);
}
