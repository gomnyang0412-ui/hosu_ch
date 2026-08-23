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
    // 20화씩 묶으면 압축률(6~7만 자 → 3~6문장)이 너무 높아 100화
    // 이상 이야기에서 초반 디테일이 쉽게 사라진다는 판단으로 10으로 줄였다.
    expect(ARC_CHUNK_SIZE).toBe(10);
  });

  it("오래된 화가 10개 미만이면 아직 압축하지 않는다", () => {
    expect(nextArcRange(62, undefined)).toBeNull();
  });

  it("오래된 화가 10개가 되면 1화부터 첫 구간을 만든다", () => {
    expect(nextArcRange(63, undefined)).toEqual({ fromIndex: 1, toIndex: 10 });
  });

  it("기존 요약 다음부터 끊김 없이 다음 10화를 묶는다", () => {
    expect(nextArcRange(73, [{ toIndex: 10 }])).toEqual({
      fromIndex: 11,
      toIndex: 20,
    });
  });

  it("기존 요약이 여러 개면 가장 멀리 압축된 지점을 기준으로 한다", () => {
    expect(nextArcRange(83, [{ toIndex: 10 }, { toIndex: 20 }])).toEqual({
      fromIndex: 21,
      toIndex: 30,
    });
  });
});
