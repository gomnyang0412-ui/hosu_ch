// 관찰 모드(단편소설) 컨텍스트 윈도우 관련 순수 유틸.
// Redis나 Gemini를 직접 부르지 않아 서버·클라이언트 어디서나 가져다 쓸 수 있다.
import type { ArcSummary } from "./types";

/** 전문 그대로 참고하는 최근 화 개수 */
export const RECENT_FULL_COUNT = 5;
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
