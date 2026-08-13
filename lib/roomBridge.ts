import type {
  ChatMessage,
  DialogueItem,
  MultiThread,
  NarrationItem,
  Room,
  RoomItem,
  SceneItem,
} from "./types";

function isSceneItem(it: RoomItem): it is (NarrationItem | DialogueItem) & { ts: number } {
  return it.t === "n" || it.t === "d";
}

function stripTs(item: SceneItem & { ts: number }): SceneItem {
  return item.t === "n"
    ? { t: "n", text: item.text }
    : {
        t: "d",
        who: item.who,
        act: item.act,
        say: item.say,
        model: item.model,
        keyIndex: item.keyIndex,
      };
}

/** 1:1 채팅의 ChatMessage[] 기록을 Room.items(RoomItem[]) 형태로 편다.
 *  메시지 하나(사용자 발화 1건, 또는 AI 한 턴의 지문+대사 여러 개)에
 *  속한 아이템들은 모두 그 메시지의 ts를 공유한다. */
export function chatMessagesToRoomItems(
  messages: ChatMessage[],
  fallbackSpeakerName: string
): RoomItem[] {
  return messages.flatMap((m): RoomItem[] => {
    if (m.role === "user") return [{ t: "u", text: m.text, ts: m.ts }];
    const items: SceneItem[] =
      m.items && m.items.length > 0
        ? m.items
        : [{ t: "d", who: fallbackSpeakerName, say: m.text }];
    return items.map((it) => ({ ...it, ts: m.ts }));
  });
}

/**
 * Room.items(RoomItem[])를 1:1 채팅 화면이 기대하는 ChatMessage[]로
 * 되돌린다. "u"(사용자 발화) 아이템은 항상 새 메시지를 시작하고, 이어지는
 * "n"/"d" 아이템 중 ts가 같은 것끼리는 하나의 AI 턴으로 묶는다 — 저장할
 * 때 한 턴의 아이템들을 항상 같은 ts로 찍어두기 때문에 가능하다.
 * (1:1 방 items에는 "x" 지시문이 나올 수 없으므로 그 경우는 없다고 본다.)
 */
export function roomItemsToChatMessages(items: RoomItem[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (item.t === "u") {
      messages.push({ role: "user", text: item.text, ts: item.ts });
      i++;
      continue;
    }
    if (!isSceneItem(item)) {
      // 1:1 방엔 있을 수 없는 종류(지시문)라 방어적으로만 건너뛴다.
      i++;
      continue;
    }
    const ts = item.ts;
    const group: SceneItem[] = [];
    while (i < items.length && items[i].ts === ts && isSceneItem(items[i])) {
      group.push(stripTs(items[i] as SceneItem & { ts: number }));
      i++;
    }
    messages.push({
      role: "model",
      text: serializeSceneItems(group),
      items: group,
      ts,
    });
  }
  return messages;
}

function serializeSceneItems(items: SceneItem[]): string {
  return items
    .map((item) =>
      item.t === "n"
        ? `(지문) ${item.text}`
        : `${item.who}${item.act ? ` (${item.act})` : ""}: ${item.say}`
    )
    .join("\n");
}

/** 예전 1:1 채팅 데이터(cc:chat:* 등)를 단일 참가자 Room으로 변환한다 */
export function chatHistoryToRoom(
  universeId: string,
  characterId: string,
  fallbackSpeakerName: string,
  history: ChatMessage[],
  voiceOverride: string | null,
  playerOverride: string | null
): Room {
  const items = chatMessagesToRoomItems(history, fallbackSpeakerName);
  const now = Date.now();
  return {
    id: `single-${characterId}`,
    universeId,
    kind: "single",
    characterIds: [characterId],
    playerCharacterId: playerOverride ?? undefined,
    aiVoiceOverrideId: voiceOverride ?? undefined,
    items,
    createdAt: items[0]?.ts ?? now,
    updatedAt: items[items.length - 1]?.ts ?? now,
  };
}

/**
 * 예전 멀티 대화방(MultiThread)을 Room으로 변환한다. id는 그대로
 * 유지해서 /thread/{id} 링크가 안 깨지게 한다. 예전 ThreadItem엔
 * 아이템별 시각이 없어서, 그 스레드의 updatedAt으로 전부 채운다 —
 * 오래된 스레드는 타임라인에서 하루로 뭉쳐 보이지만 원래 없던 기능이
 * 새로 생기는 것뿐이라 회귀는 아니다.
 */
export function threadToRoom(thread: MultiThread): Room {
  const items: RoomItem[] = thread.items.map((it) => ({
    ...it,
    ts: thread.updatedAt,
  }));
  return {
    id: thread.id,
    universeId: thread.universeId,
    kind: "group",
    characterIds: thread.characterIds,
    title: thread.title,
    playerCharacterId: thread.playerCharacterId,
    items,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}
