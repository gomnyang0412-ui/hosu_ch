// 1:1 채팅 화면의 날짜 구분선·날짜별 이동 패널에서 공통으로 쓰는 순수 유틸.
// 컴포넌트 여러 개(채팅 페이지 본문 + TimelinePanel)에서 같이 쓰므로 분리했다.
import { kstDateString } from "./memory";
import type { ChatMessage } from "./types";

export function dateAnchorId(date: string): string {
  return `date-${date}`;
}

/** "2026-08-09" → "8월 9일 (일)" */
export function formatDateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  return d.toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export interface DateGroup {
  date: string;
  count: number;
  preview: string;
}

/** 대화 기록을 KST 날짜별로 묶어, 날짜 이동 패널에 보여줄 요약을 만든다 */
export function groupMessagesByDate(messages: ChatMessage[]): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const m of messages) {
    const date = kstDateString(m.ts);
    const last = groups[groups.length - 1];
    if (last && last.date === date) {
      last.count++;
    } else {
      groups.push({ date, count: 1, preview: m.text.slice(0, 40) });
    }
  }
  return groups;
}
