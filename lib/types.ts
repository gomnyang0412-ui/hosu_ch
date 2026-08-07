// 앱 전역에서 쓰는 데이터 타입 정의

/** 캐릭터마다 부여할 강조색 후보 */
export const ACCENT_COLORS = [
  "#4B3F72",
  "#2F6B5E",
  "#8C4A3F",
  "#3B5C86",
  "#6B4A78",
  "#2E5F6B",
] as const;

export type AccentColor = (typeof ACCENT_COLORS)[number];

/** 캐릭터 한 명의 설정 */
export interface Character {
  id: string;
  name: string;
  oneLiner: string;
  /** 목표 */
  goal?: string;
  /** 외형 특징 */
  appearance?: string;
  /** 향 노트 */
  scentNote?: string;
  personality: string;
  speechStyle: string;
  /** 배경 이야기 */
  background?: string;
  /** 살아온 궤적 */
  lifeHistory?: string;
  /** 연관 인물 (이 캐릭터와 개인적으로 얽힌 인물) */
  relatedCharacters?: string;
  /** 애정 관계 */
  romance?: string;
  firstMessage: string;
  /** 리사이즈된 프로필 이미지 (base64 dataURL). 없으면 undefined */
  image?: string;
  accentColor: AccentColor;
  createdAt: number;
  updatedAt: number;
}

/** AI 프롬프트에 필요한 캐릭터 설정만 추린 형태 (프로필 이미지 등 UI 전용 필드는 제외) */
export interface CharacterProfile {
  name: string;
  oneLiner: string;
  goal?: string;
  appearance?: string;
  scentNote?: string;
  personality: string;
  speechStyle: string;
  background?: string;
  lifeHistory?: string;
  relatedCharacters?: string;
  romance?: string;
}

export function toCharacterProfile(c: Character): CharacterProfile {
  return {
    name: c.name,
    oneLiner: c.oneLiner,
    goal: c.goal,
    appearance: c.appearance,
    scentNote: c.scentNote,
    personality: c.personality,
    speechStyle: c.speechStyle,
    background: c.background,
    lifeHistory: c.lifeHistory,
    relatedCharacters: c.relatedCharacters,
    romance: c.romance,
  };
}

/** 관계 입력 칸 개수 (관계 1 ~ 관계 10) */
export const RELATION_SLOT_COUNT = 10;

/** 오리지널 세계관(ORG)의 고정 id */
export const ORG_UNIVERSE_ID = "org";

export type UniverseType = "org" | "au";

/**
 * 세계관 하나. 오리지널 세계관(ORG)도, 각 AU도 모두 이 형태로 저장된다.
 * 캐릭터는 그대로 두고 이 세계관 설정만 바꿔서 대화/관찰에 사용한다.
 */
export interface Universe {
  id: string;
  type: UniverseType;
  /** ORG는 고정 문구, AU는 사용자가 짓는 제목 */
  title: string;
  /** AU 소개 문구 (카드에 짧게 보여줄 설명) */
  tagline?: string;
  /** AU 해시태그 (예: ["느와르", "현대물"]) */
  tags?: string[];
  worldSetting: string;
  /** 파벌 */
  faction: string;
  /** 관계 1 ~ 10. 배열 길이는 항상 RELATION_SLOT_COUNT */
  relations: string[];
  /** 용어 및 설정 사전 */
  glossary: string;
  /** 요약 */
  summary: string;
  /** 리사이즈된 표지 이미지 (base64 dataURL). 없으면 undefined */
  image?: string;
  createdAt: number;
  updatedAt: number;
}

export function emptyUniverseFields(): Pick<
  Universe,
  "worldSetting" | "faction" | "relations" | "glossary" | "summary" | "image"
> {
  return {
    worldSetting: "",
    faction: "",
    relations: Array(RELATION_SLOT_COUNT).fill(""),
    glossary: "",
    summary: "",
    image: undefined,
  };
}

export function createOrgUniverse(): Universe {
  const now = Date.now();
  return {
    id: ORG_UNIVERSE_ID,
    type: "org",
    title: "오리지널 세계관",
    ...emptyUniverseFields(),
    createdAt: now,
    updatedAt: now,
  };
}

/** 1:1 대화 한 마디 */
export interface ChatMessage {
  role: "user" | "model";
  text: string;
  ts: number;
}

/** 관찰 모드 장면 한 항목 - 지문 */
export interface NarrationItem {
  t: "n";
  text: string;
}

/** 관찰 모드 장면 한 항목 - 대사 */
export interface DialogueItem {
  t: "d";
  who: string;
  act?: string;
  say: string;
}

export type SceneItem = NarrationItem | DialogueItem;

/** 진행 중인 관찰 모드 세션 (캐릭터 선택 + 주제 + 지금까지의 장면) */
export interface ObservationSession {
  universeId: string;
  characterIds: string[];
  topic: string;
  items: SceneItem[];
  createdAt: number;
  updatedAt: number;
}
