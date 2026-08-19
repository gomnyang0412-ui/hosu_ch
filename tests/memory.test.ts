import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMemoryBlock,
  daysAgo,
  isoWeekEndDate,
  isoWeekLabel,
  kstDateString,
  memoryOneLiners,
  monthLabel,
} from "@/lib/memory";
import type { CharacterMemory } from "@/lib/types";

afterEach(() => vi.useRealTimers());

describe("캐릭터 기억 날짜와 프롬프트", () => {
  it("UTC 시각을 한국 날짜 경계에 맞춰 변환한다", () => {
    expect(kstDateString(Date.parse("2026-08-18T14:59:59Z"))).toBe("2026-08-18");
    expect(kstDateString(Date.parse("2026-08-18T15:00:00Z"))).toBe("2026-08-19");
  });

  it("연말을 가로지르는 ISO 주차와 그 주의 일요일을 계산한다", () => {
    expect(isoWeekLabel("2025-12-29")).toBe("2026-W01");
    expect(isoWeekEndDate("2026-W01")).toBe("2026-01-04");
    expect(monthLabel("2026-01-04")).toBe("2026-01");
    expect(daysAgo("2026-08-01", "2026-08-19")).toBe(18);
  });

  it("달·주·하루 순서로 기억 한 줄을 만든다", () => {
    const memory: CharacterMemory = {
      characterId: "char-1",
      universeId: "org",
      summarizedThrough: "2026-08-18",
      updatedAt: 1,
      entries: [
        { scope: "day", label: "2026-08-18", summary: "약속했다.", createdAt: 3 },
        { scope: "month", label: "2026-06", summary: "도시를 떠났다.", createdAt: 1 },
        { scope: "week", label: "2026-W32", summary: "다시 만났다.", createdAt: 2 },
      ],
    };

    expect(memoryOneLiners(memory)).toEqual([
      "- 그 달(2026-06) 있었던 일들: 도시를 떠났다.",
      "- 그 주(2026-W32) 있었던 일들: 다시 만났다.",
      "- 2026-08-18: 약속했다.",
    ]);
  });

  it("현재 한국 날짜와 모든 기억을 시스템 프롬프트 블록에 넣는다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T03:00:00Z"));
    const memory: CharacterMemory = {
      characterId: "char-1",
      universeId: "au-1",
      summarizedThrough: "2026-08-18",
      updatedAt: 1,
      entries: [
        { scope: "day", label: "2026-08-18", summary: "비밀을 들었다.", createdAt: 1 },
      ],
    };

    const block = buildMemoryBlock("해원", memory);
    expect(block).toContain("[기억]\n오늘은 2026-08-19이다.");
    expect(block).toContain('"해원"은(는)');
    expect(block).toContain("- 2026-08-18: 비밀을 들었다.");
    expect(buildMemoryBlock("해원", null)).toBe("");
  });
});
