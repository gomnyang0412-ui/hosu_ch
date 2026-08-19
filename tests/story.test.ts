import { describe, expect, it } from "vitest";
import {
  ARC_CHUNK_SIZE,
  RECAP_LIMIT,
  RECENT_FULL_COUNT,
  nextArcRange,
} from "@/lib/story";

describe("관찰 모드 구간 요약 범위", () => {
  it("현재 튜닝된 최근 전문·줄거리·구간 크기를 고정한다", () => {
    expect(RECENT_FULL_COUNT).toBe(3);
    expect(RECAP_LIMIT).toBe(50);
    expect(ARC_CHUNK_SIZE).toBe(20);
  });

  it("오래된 화가 20개 미만이면 아직 압축하지 않는다", () => {
    expect(nextArcRange(72, undefined)).toBeNull();
  });

  it("오래된 화가 20개가 되면 1화부터 첫 구간을 만든다", () => {
    expect(nextArcRange(73, undefined)).toEqual({ fromIndex: 1, toIndex: 20 });
  });

  it("기존 요약 다음부터 끊김 없이 다음 20화를 묶는다", () => {
    expect(nextArcRange(93, [{ toIndex: 20 }])).toEqual({
      fromIndex: 21,
      toIndex: 40,
    });
  });

  it("기존 요약이 여러 개면 가장 멀리 압축된 지점을 기준으로 한다", () => {
    expect(nextArcRange(113, [{ toIndex: 20 }, { toIndex: 40 }])).toEqual({
      fromIndex: 41,
      toIndex: 60,
    });
  });
});
