// 관찰 모드(단편소설) 컨텍스트 윈도우 관련 순수 유틸.
// Redis나 Gemini를 직접 부르지 않아 서버·클라이언트 어디서나 가져다 쓸 수 있다.
import type { ArcSummary } from "./types";

// 매 화 생성 요청마다 이 개수만큼의 최근 화를 전문 그대로 다시 보낸다.
// 한 화가 2800~3400자라, 이 값이 클수록 매번 보내는 프롬프트가
// 커져서(이야기가 길어질수록 계속) 생성이 느려진다 — AU 관찰모드
// 타임아웃의 가장 큰 원인이었다. 빠지는 화는 바로 아래 [지금까지의
// 줄거리] 한 줄 요약과 구간 요약이 대신 맥락을 이어준다.
/** 전문 그대로 참고하는 최근 화 개수 */
export const RECENT_FULL_COUNT = 3;
/** 한 줄 줄거리 요약에 넣는 화 개수 상한(최근 화 제외) */
export const RECAP_LIMIT = 50;
/** 구간 요약 하나가 묶는 화 개수 */
export const ARC_CHUNK_SIZE = 20;

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
