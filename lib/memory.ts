// 캐릭터별 누적 기억(CharacterMemory) 관련 순수 유틸.
// Redis나 Gemini를 직접 부르지 않아 서버·클라이언트 어디서나 가져다 쓸 수 있다.
import type { CharacterMemory, MemoryEntry } from "./types";

/** 이 시간을 KST(한국 시간) 기준 YYYY-MM-DD 날짜 문자열로 바꾼다 */
export function kstDateString(ts: number): string {
  return new Date(ts).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

/** 지금 이 순간의 KST 날짜 문자열 */
export function todayKST(): string {
  return kstDateString(Date.now());
}

// Gemini API의 하루 요청 한도(RPD)는 한국 시간이 아니라 태평양 시간
// 자정에 초기화된다(서머타임 여부에 따라 한국 시간으로는 오후 4~5시경).
// 이 시간대는 이 IANA 타임존이 서머타임 전환까지 알아서 계산해준다 —
// lib/db.ts의 recordApiUsage/getApiUsage(사용량 집계 "하루" 경계)에만 쓴다.
export function todayPacific(): string {
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "America/Los_Angeles",
  });
}

/** "2026-08-08" 같은 날짜 문자열의 ISO 주차 라벨("2026-W32")을 구한다 */
export function isoWeekLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dayNum = (d.getUTCDay() + 6) % 7; // 월=0 ... 일=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // 이 주의 목요일로 이동
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week =
    1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** ISO 주차 라벨의 마지막 날(일요일) 날짜 문자열을 구한다 (압축 시점 판단용) */
export function isoWeekEndDate(weekLabel: string): string {
  const [yearStr, weekStr] = weekLabel.split("-W");
  const year = Number(yearStr);
  const week = Number(weekStr);
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const thursday = new Date(firstThursday);
  thursday.setUTCDate(thursday.getUTCDate() + (week - 1) * 7);
  const sunday = new Date(thursday);
  sunday.setUTCDate(sunday.getUTCDate() + 3);
  return sunday.toISOString().slice(0, 10);
}

/** 날짜 문자열의 "YYYY-MM" 달 라벨 */
export function monthLabel(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** 오늘부터 며칠 전인지 (dateStr이 과거일수록 큰 값) */
export function daysAgo(dateStr: string, today = todayKST()): number {
  const a = new Date(`${dateStr}T00:00:00Z`).getTime();
  const b = new Date(`${today}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

// 최근 14일은 하루 단위로 그대로 두고, 그보다 오래돼 안정적으로 지난
// 주는 주 단위로, 8주(~2개월)보다 오래된 주는 달 단위로 뭉친다.
export const WEEK_COMPACT_AFTER_DAYS = 14;
export const MONTH_COMPACT_AFTER_WEEKS = 8;

// 한 번의 동기화 요청에는 여러 캐릭터 × 유니버스 조합이 걸릴 수 있고,
// 조합 하나당 밀린 날짜 하나마다 Gemini 호출이 하나씩 들어간다. 서버리스
// 함수 제한 시간 안에 넉넉히 끝나는 것뿐 아니라, 캐릭터가 대화 화면에서
// 직접 쓰는 Gemini 호출(같은 API 키)과 한꺼번에 몰려 서로 느려지지
// 않도록, 한 조합당 이만큼만 처리하고 나머지는 다음 동기화(클라이언트가
// 필요하면 곧바로 다시 호출)로 넘긴다.
export const MAX_PENDING_DAYS_PER_SYNC = 3;

function scopeRank(scope: MemoryEntry["scope"]): number {
  return scope === "month" ? 0 : scope === "week" ? 1 : 2;
}

/** 오래된(달) → 최신(하루) 순으로 정렬한다 (프롬프트에 시간 순으로 보여주기 위함) */
export function sortMemoryEntries(entries: MemoryEntry[]): MemoryEntry[] {
  return [...entries].sort((a, b) => {
    const rank = scopeRank(a.scope) - scopeRank(b.scope);
    if (rank !== 0) return rank;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
}

const SCOPE_PREFIX: Record<MemoryEntry["scope"], string> = {
  day: "",
  week: "그 주(",
  month: "그 달(",
};

/** 누적 기억 항목을 "- 2026-08-01: ..." 같은 한 줄씩으로 펼친다. 기억이 없으면 빈 배열 */
export function memoryOneLiners(memory: CharacterMemory | null): string[] {
  if (!memory || memory.entries.length === 0) return [];
  return sortMemoryEntries(memory.entries).map((e) => {
    if (e.scope === "day") return `- ${e.label}: ${e.summary}`;
    return `- ${SCOPE_PREFIX[e.scope]}${e.label}) 있었던 일들: ${e.summary}`;
  });
}

/** 시스템 프롬프트에 그대로 넣을 "[기억]" 블록 텍스트를 만든다. 기억이 없으면 빈 문자열 */
export function buildMemoryBlock(
  characterName: string,
  memory: CharacterMemory | null
): string {
  const lines = memoryOneLiners(memory);
  if (lines.length === 0) return "";
  return [
    `[기억]`,
    `오늘은 ${todayKST()}이다. "${characterName}"은(는) 지금 대화 상대가 누구든 상관없이 아래 기억을 전부 자기 경험으로 알고 있다 (다른 방/다른 상대와 있었던 일도 포함).`,
    ...lines,
    `이 기억을 대화 중 자연스럽게 활용하되, 상황과 무관하면 굳이 언급하지 않는다.`,
  ].join("\n");
}
