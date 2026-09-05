import { describe, expect, it } from "vitest";
import {
  ARC_CHUNK_SIZE,
  RECAP_LIMIT,
  RECENT_FULL_COUNT,
  mergeStateDelta,
  nextArcRange,
  splitDirectiveInHalf,
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

describe("관찰 모드 현재 상태 델타 병합", () => {
  it("이전 상태가 없을 때 첫 델타로 상태를 만든다", () => {
    const merged = mergeStateDelta(undefined, "[관계]\n민준과 서연은 서먹하다");
    expect(merged).toBe("[관계]\n민준과 서연은 서먹하다");
  });

  it("델타가 비어있으면(그 화에서 변화 없음) 이전 상태를 그대로 돌려준다", () => {
    const prev = "[관계]\n민준과 서연은 서먹하다";
    expect(mergeStateDelta(prev, undefined)).toBe(prev);
    expect(mergeStateDelta(prev, "")).toBe(prev);
    expect(mergeStateDelta(prev, "   ")).toBe(prev);
  });

  it("델타에 없는 항목은 이전 값을 그대로 유지하고, 언급된 항목만 갱신한다", () => {
    const prev = ["[관계]\n민준과 서연은 서먹하다", "[목표]\n승진하기"].join("\n\n");
    const merged = mergeStateDelta(prev, "[관계]\n민준과 서연이 가까워졌다");
    expect(merged).toBe(
      ["[관계]\n민준과 서연이 가까워졌다", "[목표]\n승진하기"].join("\n\n")
    );
  });

  it("여러 항목을 한 번에 갱신할 수 있다", () => {
    const prev = "[관계]\n서먹하다";
    const delta = ["[관계]\n가까워졌다", "[지위·소속·역할]\n민준: 과장으로 승진"].join(
      "\n"
    );
    const merged = mergeStateDelta(prev, delta);
    expect(merged).toBe(
      ["[관계]\n가까워졌다", "[지위·소속·역할]\n민준: 과장으로 승진"].join("\n\n")
    );
  });

  it("대괄호 태그가 없는 예전 형식 상태는 잃어버리지 않고 맨 앞에 보존한다", () => {
    const legacy = "- 인물 간 관계: 민준과 서연은 서먹하다";
    const merged = mergeStateDelta(legacy, "[목표]\n승진하기");
    expect(merged).toBe([legacy, "[목표]\n승진하기"].join("\n\n"));
  });
});

describe("관찰 모드 2화 나눠쓰기 지시문 분할", () => {
  it("줄바꿈으로 구분돼 있으면 줄 단위로 절반씩 나눈다", () => {
    const [a, b] = splitDirectiveInHalf("첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄");
    expect(a).toBe("첫째 줄\n둘째 줄");
    expect(b).toBe("셋째 줄\n넷째 줄");
  });

  it("줄바꿈 없이 문장부호로만 구분돼 있으면 문장 단위로 나눈다", () => {
    const [a, b] = splitDirectiveInHalf(
      "민준은 서연에게 고백한다. 서연은 당황해서 도망친다. 민준이 쫓아가서 붙잡는다. 서연도 결국 마음을 받아들인다."
    );
    expect(a).toBe("민준은 서연에게 고백한다. 서연은 당황해서 도망친다.");
    expect(b).toBe("민준이 쫓아가서 붙잡는다. 서연도 결국 마음을 받아들인다.");
  });

  it("문장부호 없이 단어가 충분히 많으면 단어 단위로 나눈다", () => {
    const [a, b] = splitDirectiveInHalf("가 나 다 라 마 바");
    expect(a).toBe("가 나 다");
    expect(b).toBe("라 마 바");
  });

  it("나눌 단위가 없는 짧은 한 덩어리는 통째로 양쪽에 준다", () => {
    const [a, b] = splitDirectiveInHalf("고백한다");
    expect(a).toBe("고백한다");
    expect(b).toBe("고백한다");
  });

  it("빈 지시문은 양쪽 다 빈 문자열", () => {
    expect(splitDirectiveInHalf("  ")).toEqual(["", ""]);
  });

  it("홀수 개는 앞쪽에 한 개 더 준다", () => {
    const [a, b] = splitDirectiveInHalf("하나. 둘. 셋.");
    expect(a).toBe("하나. 둘.");
    expect(b).toBe("셋.");
  });
});
