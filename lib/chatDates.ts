// 채팅 화면의 날짜 구분선·날짜별 이동 패널에서 공통으로 쓰는 순수 유틸.
// 컴포넌트 여러 개(채팅 페이지 본문 + TimelinePanel)에서 같이 쓰므로 분리했다.
import { kstDateString } from "./memory";
import type { ChatMessage, RoomItem } from "./types";

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

/** 멀티 대화방 items를 KST 날짜별로 묶는다. 항목 하나하나를 그대로 세는
 *  것이라(1:1처럼 턴으로 묶지 않음), 화면에 실제로 한 줄씩 그려지는
 *  멀티 대화방의 렌더링 단위와 그대로 맞아떨어진다. */
export function groupRoomItemsByDate(items: RoomItem[]): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const item of items) {
    const date = kstDateString(item.ts);
    const last = groups[groups.length - 1];
    const preview = (item.t === "d" ? item.say : item.text).slice(0, 40);
    if (last && last.date === date) {
      last.count++;
    } else {
      groups.push({ date, count: 1, preview });
    }
  }
  return groups;
}
