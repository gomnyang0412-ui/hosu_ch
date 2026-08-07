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
  personality: string;
  speechStyle: string;
  firstMessage: string;
  /** 리사이즈된 프로필 이미지 (base64 dataURL). 없으면 undefined */
  image?: string;
  accentColor: AccentColor;
  createdAt: number;
  updatedAt: number;
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
