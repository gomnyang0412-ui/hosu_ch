// 앱 전역에서 쓰는 데이터 타입 정의

/** 캐릭터마다 부여할 강조색 후보 (메신저풍 선명한 팔레트) */
export const ACCENT_COLORS = [
  "#1F9D75",
  "#E2694B",
  "#3E7CB8",
  "#C25693",
  "#D9A441",
  "#6A66C7",
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
  /**
   * 역할 반전: 이 값이 있으면 이 캐릭터의 1:1 방에서 AI는 이 캐릭터가
   * 아니라 이 id의 캐릭터를 연기한다. 사용자가 입력하는 메시지는
   * 이 캐릭터(방 주인) 본인이 하는 말로 취급된다.
   */
  aiVoiceCharacterId?: string;
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
  /**
   * AU 전용: 세계관 설정 속 {{A}}, {{B}}가 실제로 어떤 캐릭터인지 배정한 값.
   * 대화·관찰 시작 시 이 캐릭터 이름으로 치환된다.
   */
  roleA?: string;
  roleB?: string;
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

/**
 * 1:1 대화 한 마디.
 * role이 "model"인 경우 items(지문+대사 혼합)가 있으면 그걸로 그리고,
 * text는 대화 맥락을 AI에게 다시 보여줄 때 쓰는 평문 요약이다.
 * role이 "user"인 경우 items 없이 text만 쓴다.
 */
export interface ChatMessage {
  role: "user" | "model";
  text: string;
  items?: SceneItem[];
  ts: number;
}

/** 지문(상황·심리 묘사) 항목 */
export interface NarrationItem {
  t: "n";
  text: string;
}

/** 캐릭터 대사 항목 */
export interface DialogueItem {
  t: "d";
  who: string;
  act?: string;
  say: string;
}

/** 지문 + 대사. 관찰 모드 장면과 1:1 대화의 캐릭터 응답에 공통으로 쓴다 */
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

/** 멀티 대화방에서 사용자가 직접 보낸 한 마디 */
export interface UserItem {
  t: "u";
  text: string;
}

/** 멀티 대화방에서 사용자가 넣는 "상황 전환" 지시문 (화면엔 구분선처럼 표시) */
export interface DirectiveItem {
  t: "x";
  text: string;
}

/** 멀티 대화방 기록 한 항목 (지문/대사/사용자 발화/상황 전환) */
export type ThreadItem = SceneItem | UserItem | DirectiveItem;

/**
 * 여러 캐릭터 + 나가 참가자인 연속 대화방.
 * 캐릭터를 바꿔가며 이야기해도 하나의 items 배열을 공유하므로
 * 모든 참가 캐릭터가 지금까지의 흐름을 알고 있다.
 */
export interface MultiThread {
  id: string;
  universeId: string;
  /** 참가 캐릭터 id 목록. 순서 = 화면에 보여줄 칩 순서 */
  characterIds: string[];
  /** 목록 화면에 보여줄 제목 (없으면 참가자 이름으로 대신 표시) */
  title?: string;
  items: ThreadItem[];
  createdAt: number;
  updatedAt: number;
}

/** 기록이 하나라도 있는 대화방 하나 요약 (채팅 목록 화면에 보여줄 정보) */
export interface RoomSummary {
  kind: "single" | "group";
  universeId: string;
  /** kind가 "single"일 때만 있음 */
  characterId?: string;
  /** kind가 "group"일 때만 있음 */
  threadId?: string;
  title: string;
  preview: string;
  updatedAt: number;
}
