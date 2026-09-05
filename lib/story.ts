// 관찰 모드(단편소설) 컨텍스트 윈도우 관련 순수 유틸.
// Redis나 Gemini를 직접 부르지 않아 서버·클라이언트 어디서나 가져다 쓸 수 있다.
import type { ArcSummary } from "./types";

// 매 화 생성 요청마다 이 개수만큼의 최근 화를 전문 그대로 다시 보낸다.
// 한 화가 2800~3000자라, 이 값이 클수록 매번 보내는 프롬프트가
// 커져서(이야기가 길어질수록 계속) 생성이 느려진다 — AU 관찰모드
// 타임아웃의 가장 큰 원인이었다. 빠지는 화는 바로 아래 [지금까지의
// 줄거리] 한 줄 요약과 구간 요약이 대신 맥락을 이어준다.
/** 전문 그대로 참고하는 최근 화 개수 */
export const RECENT_FULL_COUNT = 3;
/** 한 줄 줄거리 요약에 넣는 화 개수 상한(최근 화 제외) */
export const RECAP_LIMIT = 50;
// 구간 하나가 20화(약 6~7만 자)를 3~6문장으로 압축하면 손실이 너무
// 커서, 이야기가 100화 넘게 길어지면 초반의 작지만 나중에 다시 쓰일
// 법한 디테일(약속, 복선)이 사라지기 쉬웠다. 10화 단위로 좁혀서 묶음당
// 압축률을 낮췄다(대신 구간 요약 호출은 그만큼 더 자주 일어난다).
/** 구간 요약 하나가 묶는 화 개수 */
export const ARC_CHUNK_SIZE = 10;

/**
 * "2화로 나눠 쓰기"에서 사용자 지시문을 앞뒤 절반으로 나눈다.
 *
 * 처음엔 지시문 전체를 두 화 모두에 그대로 보내고 "이번 화에서는
 * 앞부분만 다뤄라" 같은 프롬프트 지시로만 분량을 조절하려 했는데,
 * 지시문이 길고 구체적일수록 AI가 그 안내보다 지시문 자체의 내용을
 * 우선해서 결국 1화 안에 전부 욱여넣는 경향이 강했다(2026-09-03
 * 사용자 리포트: "2화가 되도록 엄청 긴 지시문을 줬는데도 1화에 다
 * 우겨넣으려 하네"). 그래서 아예 1화 요청에는 지시문의 뒷부분 자체를
 * 안 보이게 만든다 — 모델이 없는 내용을 미리 당겨쓸 수는 없으니, 프롬프트
 * 지시에만 의존할 때보다 훨씬 확실하게 분량이 나뉜다.
 *
 * 정확한 의미 단위 분할은 아니다. 줄바꿈 → 문장부호 → 단어 순으로,
 * 나눌 수 있는 가장 자연스러운 단위를 찾아 개수 기준 절반으로 자른다.
 * 그중 아무 기준으로도 나눌 수 없는 아주 짧은 한 덩어리 지시문이면
 * 그냥 통째로 양쪽에 준다(애초에 나눠 쓸 만큼 긴 지시문이 아니라는 뜻).
 */
export function splitDirectiveInHalf(directive: string): [string, string] {
  const trimmed = directive.trim();
  if (!trimmed) return ["", ""];

  const lines = trimmed
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length >= 2) {
    const mid = Math.ceil(lines.length / 2);
    return [lines.slice(0, mid).join("\n"), lines.slice(mid).join("\n")];
  }

  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length >= 2) {
    const mid = Math.ceil(sentences.length / 2);
    return [sentences.slice(0, mid).join(" "), sentences.slice(mid).join(" ")];
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 4) {
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  }

  return [trimmed, trimmed];
}

/**
 * (RECENT_FULL_COUNT + RECAP_LIMIT)화보다 오래된 화는 지금까지 그냥
 * 컨텍스트에서 사라졌다. 그중 아직 구간 요약으로 안 묶인 화가
 * ARC_CHUNK_SIZE만큼 쌓였으면, 그 범위를 돌려준다(없으면 null).
 * arcSummaries는 항상 1화부터 끊김 없이 이어진다고 가정한다.
 */
export function nextArcRange(
  totalEpisodes: number,
  arcSummaries: Pick<ArcSummary, "toIndex">[] | undefined
): { fromIndex: number; toIndex: number } | null {
  const coveredThrough =
    arcSummaries && arcSummaries.length > 0
      ? Math.max(...arcSummaries.map((a) => a.toIndex))
      : 0;
  const boundary = totalEpisodes - (RECENT_FULL_COUNT + RECAP_LIMIT);
  if (boundary - coveredThrough < ARC_CHUNK_SIZE) return null;
  return { fromIndex: coveredThrough + 1, toIndex: coveredThrough + ARC_CHUNK_SIZE };
}

/**
 * 경과 일수를 "2년 3개월", "5개월", "12일" 같은 한국어 문구로 바꾼다.
 * 1개월=30일, 1년=365일로 근사한다 — 실제 날짜 계산이 아니라 이야기
 * 속 시간 흐름을 대략적으로 보여주기 위한 표기용이다.
 */
export function formatElapsedDays(days: number): string {
  if (days <= 0) return "";
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const remDays = days % 365 % 30;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years}년`);
  if (months > 0) parts.push(`${months}개월`);
  if (years === 0 && months === 0 && remDays > 0) parts.push(`${remDays}일`);
  return parts.join(" ") || `${days}일`;
}

/**
 * [현재 상태](ObservationSession.currentState)가 인정하는 항목 태그.
 * app/api/scene/route.ts가 이 목록 그대로 시스템 프롬프트에 나열해서
 * AI가 상태 델타를 쓸 때 정확히 이 대괄호 표기를 쓰게 지시한다 — 여기서
 * 하나라도 벗어나면(오타, 다른 표현) mergeStateDelta가 새 항목으로
 * 잘못 갈라서 그 항목의 이전 값을 이어받지 못한다.
 */
export const STATE_CATEGORIES = [
  "관계",
  "성격·감정",
  "지위·소속·역할",
  "외형·부상·복장",
  "경과 시간 반영",
  "위치/상황",
  "아는 정보",
  "목표",
  "미해결 약속·복선",
  "돌이킬 수 없는 사건",
] as const;

// 이번 화 전에 이미 저장돼 있던 상태 문구 중, 대괄호 태그가 하나도 안
// 붙은 부분(예전 방식 — 안 바뀐 항목도 매번 통째로 다시 썼던 시절의
// 텍스트, 또는 AI가 태그를 안 붙이고 쓴 잡담)을 담아두는 자리.
// 태그가 없다고 버리면 그 시점까지 쌓인 상태가 통째로 사라지므로,
// 내용은 그대로 보존하되 화면에 보일 때 맨 앞에 얹는다.
const LEGACY_TAG = "__legacy__";

/** "[태그] 내용" 형식의 텍스트를 태그별 내용 맵으로 나눈다. 태그가 붙기
 *  전에 나온 줄들은 LEGACY_TAG로 묶는다. */
function parseStateBlock(text: string): Map<string, string> {
  const map = new Map<string, string>();
  let currentTag: string | null = null;
  let buffer: string[] = [];
  const preTagBuffer: string[] = [];
  const flush = () => {
    if (currentTag) {
      const content = buffer.join("\n").trim();
      if (content) map.set(currentTag, content);
    }
    buffer = [];
  };
  for (const line of text.split("\n")) {
    const match = line.match(/^\[([^\]]+)\]\s?(.*)$/);
    if (match) {
      flush();
      currentTag = match[1].trim();
      buffer = match[2] ? [match[2]] : [];
    } else if (currentTag) {
      buffer.push(line);
    } else {
      preTagBuffer.push(line);
    }
  }
  flush();
  const legacy = preTagBuffer.join("\n").trim();
  if (legacy) map.set(LEGACY_TAG, legacy);
  return map;
}

/** 태그별 내용 맵을 다시 "[태그]\n내용" 블록들로 합친다. STATE_CATEGORIES
 *  순서대로 정렬하고, legacy(태그 없는 옛 내용)는 맨 앞에 그대로 둔다. */
function serializeStateMap(map: Map<string, string>): string {
  const blocks: string[] = [];
  const legacy = map.get(LEGACY_TAG);
  if (legacy) blocks.push(legacy);
  for (const tag of STATE_CATEGORIES) {
    const content = map.get(tag);
    if (content) blocks.push(`[${tag}]\n${content}`);
  }
  const knownTags = new Set<string>([LEGACY_TAG, ...STATE_CATEGORIES]);
  for (const [tag, content] of map) {
    if (!knownTags.has(tag)) blocks.push(`[${tag}]\n${content}`);
  }
  return blocks.join("\n\n");
}

/**
 * AI가 이번 화에서 실제로 바뀐 항목만 적어 보낸 델타(delta)를 이전
 * [현재 상태]에 병합한다. 안 바뀐 항목은 AI가 매번 통째로 옮겨 적을
 * 필요가 없어 출력이 훨씬 짧아지고, "안 바뀐 값을 옮겨 적다 미묘하게
 * 달라지는" 드리프트 위험도 없앤다 — 안 바뀐 부분은 이 함수가 이전
 * 값을 그대로 유지해준다.
 *
 * delta가 비어있거나(그 화에서 아무것도 안 바뀜) 형식을 못 알아보면
 * previousState를 그대로 돌려준다(빈 값으로 덮어쓰지 않는다).
 */
export function mergeStateDelta(
  previousState: string | undefined,
  delta: string | undefined
): string | undefined {
  const deltaMap = delta?.trim() ? parseStateBlock(delta) : new Map<string, string>();
  if (deltaMap.size === 0) return previousState;
  const baseMap = previousState ? parseStateBlock(previousState) : new Map<string, string>();
  for (const [tag, content] of deltaMap) baseMap.set(tag, content);
  return serializeStateMap(baseMap) || undefined;
}
