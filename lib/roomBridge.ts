import type { ChatMessage, ThreadItem } from "./types";

/**
 * 1:1 채팅의 ChatMessage[] 기록을 멀티 대화방과 같은 ThreadItem[] 형태로
 * 바꾼다. /api/room-chat이 두 화면 공통 계약(ThreadItem[])을 쓰기 때문에,
 * 1:1은 요청을 만들 때만 이렇게 즉석으로 변환한다 — 저장 형식(ChatMessage[])
 * 자체는 이 단계에서 바꾸지 않는다.
 */
export function chatMessagesToThreadItems(
  messages: ChatMessage[],
  fallbackSpeakerName: string
): ThreadItem[] {
  return messages.flatMap((m): ThreadItem[] => {
    if (m.role === "user") return [{ t: "u", text: m.text }];
    if (m.items && m.items.length > 0) return m.items;
    return [{ t: "d", who: fallbackSpeakerName, say: m.text }];
  });
}
