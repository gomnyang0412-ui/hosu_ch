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

/** 모든 캐릭터가 공유하는 세계관 설정 */
export interface World {
  worldSetting: string;
  relatedPeople: string;
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
  characterIds: string[];
  topic: string;
  items: SceneItem[];
  createdAt: number;
  updatedAt: number;
}
