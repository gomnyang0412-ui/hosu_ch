import { describe, expect, it, vi } from "vitest";
import {
  chatHistoryToRoom,
  chatMessagesToRoomItems,
  roomItemsToChatMessages,
  threadToRoom,
} from "@/lib/roomBridge";
import type { ChatMessage, MultiThread } from "@/lib/types";

describe("예전 대화 형식과 Room 변환", () => {
  const history: ChatMessage[] = [
    { role: "user", text: "왔어?", ts: 100 },
    {
      role: "model",
      text: "예전 평문",
      ts: 200,
      items: [
        { t: "n", text: "창가에서 돌아본다." },
        { t: "d", who: "해원", act: "고개를 들며", say: "응.", model: "model-a", keyIndex: 2 },
      ],
    },
  ];

  it("메시지 순서와 한 AI 턴의 공통 시각을 RoomItem에 보존한다", () => {
    expect(chatMessagesToRoomItems(history, "해원")).toEqual([
      { t: "u", text: "왔어?", ts: 100 },
      { t: "n", text: "창가에서 돌아본다.", ts: 200 },
      {
        t: "d",
        who: "해원",
        act: "고개를 들며",
        say: "응.",
        model: "model-a",
        keyIndex: 2,
        ts: 200,
      },
    ]);
  });

  it("RoomItem을 다시 읽을 때 같은 시각의 지문과 대사를 한 AI 턴으로 묶는다", () => {
    const converted = roomItemsToChatMessages(
      chatMessagesToRoomItems(history, "해원")
    );

    expect(converted[0]).toEqual(history[0]);
    expect(converted[1]).toEqual({
      role: "model",
      text: "(지문) 창가에서 돌아본다.\n해원 (고개를 들며): 응.",
      items: history[1].items,
      ts: 200,
    });
  });

  it("items가 없는 예전 AI 메시지는 지정된 화자의 대사로 복원한다", () => {
    const items = chatMessagesToRoomItems(
      [{ role: "model", text: "늦었네.", ts: 300 }],
      "해원"
    );

    expect(items).toEqual([{ t: "d", who: "해원", say: "늦었네.", ts: 300 }]);
  });

  it("예전 1:1 기록의 방 ID·역할 설정·처음과 마지막 시각을 유지한다", () => {
    vi.spyOn(Date, "now").mockReturnValue(999);
    const room = chatHistoryToRoom("org", "char-1", "해원", history, "voice-2", "player-3");

    expect(room).toMatchObject({
      id: "single-char-1",
      universeId: "org",
      kind: "single",
      characterIds: ["char-1"],
      aiVoiceOverrideId: "voice-2",
      playerCharacterId: "player-3",
      createdAt: 100,
      updatedAt: 200,
    });
    vi.restoreAllMocks();
  });

  it("예전 그룹 대화방의 링크와 메타데이터를 유지한다", () => {
    const thread: MultiThread = {
      id: "thread-1",
      universeId: "au-1",
      characterIds: ["a", "b"],
      title: "야간 순찰",
      playerCharacterId: "a",
      items: [{ t: "x", text: "비가 내리기 시작한다" }, { t: "d", who: "B", say: "가자." }],
      createdAt: 10,
      updatedAt: 20,
    };

    expect(threadToRoom(thread)).toEqual({
      id: "thread-1",
      universeId: "au-1",
      kind: "group",
      characterIds: ["a", "b"],
      title: "야간 순찰",
      playerCharacterId: "a",
      items: [
        { t: "x", text: "비가 내리기 시작한다", ts: 20 },
        { t: "d", who: "B", say: "가자.", ts: 20 },
      ],
      createdAt: 10,
      updatedAt: 20,
    });
  });
});
