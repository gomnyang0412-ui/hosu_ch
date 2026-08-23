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
  /** 리사이즈된 프로필 이미지 (base64 dataURL). 대화 화면 등에 표시되는 아바타. 없으면 undefined */
  image?: string;
  /** 참고용 전신 사진 등 추가 이미지 (base64 dataURL). 대화 아바타로는 쓰이지 않고 편집 화면에서만 보여준다 */
  referenceImage?: string;
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
   * AU 전용: 세계관 설정 속 {{A}}, {{B}}, {{C}}가 실제로 어떤 캐릭터인지
   * 배정한 값. 대화·관찰 시작 시 이 캐릭터 이름으로 치환된다. 2인 관계
   * 중심 AU는 A/B만 쓰고, 3인 이상 얽히는 AU는 C까지 쓸 수 있다.
   */
  roleA?: string;
  roleB?: string;
  roleC?: string;
  worldSetting: string;
  /** 파벌 */
  faction: string;
  /** 관계 1 ~ 10. 배열 길이는 항상 RELATION_SLOT_COUNT */
  relations: string[];
  /** 용어 및 설정 사전 */
  glossary: string;
  /** 한두 문장짜리 핵심 요약(무드·후킹 포인트). 목록 미리보기에도 쓰인다 —
   *  세계관(worldSetting)의 디테일을 다시 풀어 쓰지 않게 짧게 유지한다 */
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
  /** 1:1 대화방에 며칠 만에 다시 들어왔을 때 자동으로 끼워 넣는 "지금까지의
   *  줄거리" 지문인지. 이 표시가 있어야 (a) 새 대화 없이 다시 들어왔을 때
   *  또 끼워 넣지 않고, (b) 화면에서 개별적으로 지울 수 있는 버튼을 붙인다. */
  isRecap?: boolean;
}

/** 캐릭터 대사 항목 */
export interface DialogueItem {
  t: "d";
  who: string;
  act?: string;
  say: string;
  /** 이 대사를 생성한 실제 Gemini 모델 ID (하이브리드 폴백 중 어떤 모델이 응답했는지 표시용) */
  model?: string;
  /** GEMINI_API_KEY에 등록된 몇 번째 키(1부터)로 호출했는지 */
  keyIndex?: number;
}

/** 지문 + 대사. 1:1 대화와 멀티 대화방의 캐릭터 응답에 공통으로 쓴다 */
export type SceneItem = NarrationItem | DialogueItem;

/** 관찰 모드 단편소설의 한 화 */
export interface StoryEpisode {
  /** 1부터 시작하는 화 번호 */
  index: number;
  /** 완성된 본문 (평문, 대사는 큰따옴표로 문단 안에 녹아 있음) */
  text: string;
  /** 이 화를 쓸 때 사용자가 준 한 줄짜리 방향 지시 (없으면 자유 전개) */
  directive?: string;
  /** 나중에 다시 찾아보기 쉽게 사용자가 표시해두는 북마크 */
  bookmarked?: boolean;
  /** 이 화를 생성한 실제 Gemini 모델 ID (하이브리드 폴백 중 어떤 모델이 응답했는지 표시용) */
  model?: string;
  /** GEMINI_API_KEY에 등록된 몇 번째 키(1부터)로 호출했는지 */
  keyIndex?: number;
}

/**
 * 오래돼 더는 전문/한 줄 요약으로 안 다루는 화들을 몇 화씩 묶어 압축한
 * 구간 요약. fromIndex~toIndex는 항상 1화부터 끊김 없이 이어진다.
 */
export interface ArcSummary {
  fromIndex: number;
  toIndex: number;
  summary: string;
  createdAt: number;
}

/** 관찰 모드로 이어 쓰는 단편소설 하나 (캐릭터 선택 + 주제 + 지금까지 이어 쓴 화들) */
export interface ObservationSession {
  id: string;
  universeId: string;
  characterIds: string[];
  topic: string;
  episodes: StoryEpisode[];
  /**
   * 시작할 때 한 번 가져온 등장인물들의 1:1 대화 요약. 캐릭터가 실제로
   * 어떻게 말하고 행동하는지 붕괴 없이 참고할 수 있도록 매 화 생성에
   * 계속 같이 보낸다.
   */
  characterContext?: string;
  /** 너무 오래돼 전문/한 줄 요약 범위 밖으로 밀려난 화들을 묶어 압축한
   *  구간 요약들. 오래된 순. lib/story.ts의 nextArcRange가 관리한다. */
  arcSummaries?: ArcSummary[];
  /** 이야기 시작할 때 사용자가 고른 책 표지 이미지 (base64 dataURL). 관찰
   *  목록의 책장 화면에서 이 이야기의 표지로 쓰인다. 없으면 기본 표지로 표시. */
  coverImage?: string;
  /** 이야기 속에서 지금까지 흐른 시간(일 단위 누적). 이어쓰기 화면의
   *  "+ 시간 경과" 입력으로 쌓인다. 화가 많이 쌓여 구간 요약으로 압축돼도
   *  이 값 자체는 안 사라지도록, 있으면 매 화 프롬프트에 항상 명시적으로
   *  포함한다(app/api/scene/route.ts). */
  elapsedDays?: number;
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
 *
 * @deprecated 1:1 채팅과 통합된 Room으로 대체됐다. 이 타입은 예전 백업
 * 파일을 읽거나 한 번뿐인 마이그레이션 코드에서만 계속 쓰인다.
 */
export interface MultiThread {
  id: string;
  universeId: string;
  /** 참가 캐릭터 id 목록. 순서 = 화면에 보여줄 칩 순서 */
  characterIds: string[];
  /** 목록 화면에 보여줄 제목 (없으면 참가자 이름으로 대신 표시) */
  title?: string;
  /**
   * "나"가 characterIds 중 누구인지 (없으면 이름 없는 참가자).
   * 고르면 그 캐릭터는 AI가 연기하는 대상에서 빠지고, 다른 캐릭터들이
   * 이 인물의 배경·관계를 참고해서 반응한다.
   */
  playerCharacterId?: string;
  items: ThreadItem[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 통합 대화방 아이템. ThreadItem(지문/대사/사용자 발화/상황 전환)에
 * ts(생성 시각)만 더한 것 — 한 번의 AI 턴(또는 사용자 발화 1건)에 속한
 * 아이템들은 같은 ts를 공유한다(예전 ChatMessage.ts와 같은 단위).
 */
export type RoomItem = ThreadItem & { ts: number };

/**
 * 1:1 채팅과 멀티 대화방을 하나로 합친 대화방. characterIds가 1개면
 * 예전 1:1 채팅(id는 항상 `single-{characterId}`), 2개 이상이면 예전
 * 멀티 대화방과 같은 것이다 — 종류에 따라 저장·API·화면 로직이 갈라지지
 * 않고, 항상 같은 코드 경로로 처리된다.
 */
export interface Room {
  id: string;
  universeId: string;
  kind: "single" | "group";
  /** 참가 캐릭터 id 목록. single은 항상 1개, group은 2개 이상 */
  characterIds: string[];
  /** 목록 화면에 보여줄 제목 (없으면 참가자 이름으로 대신 표시) */
  title?: string;
  /**
   * "나"가 characterIds 중 누구인지. kind가 "group"이면 참가자 중에서만
   * 고를 수 있고(그 캐릭터는 AI가 연기하는 대상에서 빠진다), kind가
   * "single"이면 로스터 전체에서 고를 수 있다(1:1 방의 역할 반전 상대
   * 역할 — 예전 chatPlayerOverride와 같다). 이 제약은 스키마가 아니라
   * 화면(UI)에서 건다.
   */
  playerCharacterId?: string;
  /**
   * 1:1 전용: 이 방에서 AI가 실제로 연기 중인 캐릭터를 임시로 바꾼 값
   * (예전 chatVoiceOverride). group 방에는 해당 개념이 없다.
   */
  aiVoiceOverrideId?: string;
  items: RoomItem[];
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

/** 기억 항목 하나. 최근 것은 하루 단위, 오래될수록 주/달 단위로 압축된다 */
export interface MemoryEntry {
  scope: "day" | "week" | "month";
  /** scope에 맞는 기간 라벨. day: "2026-08-08", week: "2026-W32", month: "2026-08" */
  label: string;
  summary: string;
  createdAt: number;
}

/**
 * 캐릭터 한 명이 한 유니버스 안에서 (어느 방에서 대화했든) 누적해서
 * 쌓은 기억. 유니버스별로 완전히 분리된다 — AU 롤플레이가 다른
 * 유니버스(특히 ORG)의 서사까지 "기억"으로 물려받지 않게 하기 위해서다.
 * summarizedThrough는 "이 날짜까지는 이미 기억으로 정리했다"는 뜻의
 * YYYY-MM-DD(KST)이며, 그 이후 날짜의 대화만 다음 정리 대상이 된다.
 */
export interface CharacterMemory {
  characterId: string;
  universeId: string;
  summarizedThrough: string;
  entries: MemoryEntry[];
  updatedAt: number;
}

/** 앱 전체에 적용되는 개인화 설정 (유니버스·캐릭터와 무관하게 딱 하나) */
export interface AppSettings {
  /** 앱 전체 배경으로 까는 이미지 (base64 dataURL). 없으면 기본 아이보리 배경 */
  backgroundImage?: string;
  updatedAt: number;
}

/**
 * 하루 동안 API 키(1/2/3...)·모델 조합별로 실제 호출이 몇 번 성공했고
 * 몇 번 사용량 초과(quota)로 막혔는지. 구글이 API 키 기준으로는 남은
 * 할당량을 조회할 방법을 안 줘서, 앱이 스스로 호출 결과를 세어
 * "오늘 이 키·모델을 몇 번 썼는지"를 보여주는 용도 — 실제 남은 한도가
 * 아니라 우리가 직접 관측한 사용 횟수다.
 */
export interface ApiUsageEntry {
  keyIndex: number;
  model: string;
  success: number;
  quota: number;
}

/**
 * 전체 데이터 내보내기용 스냅샷. 캐릭터/세계관 전부와, 그 조합마다 있는
 * 모든 대화 기록·기억·설정을 담는다.
 *
 * rooms는 현재 형식(1:1+멀티 통합)이고, chats/threads는 통합 이전에
 * 받은 백업 파일과의 호환을 위해 남겨둔 예전 형식이다 — 불러오기는 둘
 * 중 있는 쪽을 읽는다(새 백업엔 rooms만, 예전 백업엔 chats/threads만
 * 있다).
 */
export interface FullExport {
  exportedAt: number;
  characters: Character[];
  universes: Universe[];
  /** @deprecated rooms로 대체됨. 예전 백업 파일을 불러올 때만 쓰인다 */
  chats?: {
    universeId: string;
    characterId: string;
    history: ChatMessage[];
    voiceOverride: string | null;
    playerOverride: string | null;
  }[];
  /** @deprecated rooms로 대체됨. 예전 백업 파일을 불러올 때만 쓰인다 */
  threads?: MultiThread[];
  rooms?: Room[];
  /** 관찰 모드 이야기. 이 필드가 생기기 전에 받은 예전 백업 파일에는 없을 수 있다 */
  stories?: ObservationSession[];
  memories: CharacterMemory[];
  /** 앱 개인화 설정(배경 이미지 등). 이 필드가 생기기 전 백업 파일에는 없을 수 있다 */
  appSettings?: AppSettings;
}
