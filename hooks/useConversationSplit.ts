import { useState } from "react";
import {
  getRoomForCharacter,
  saveRoom,
  storageErrorMessage,
} from "@/lib/storage";
import type { Character, Room } from "@/lib/types";

interface SplitDone {
  name: string;
  targetId: string;
}

/**
 * 1:1 대화를 특정 지점부터 다른 캐릭터 방으로 옮기는 "대화 나누기" 기능.
 * 채팅 화면 본체와 얽혀 있던 상태 5개 + 로직을 통째로 뽑아낸 것 — 동작은
 * 그대로다.
 */
export function useConversationSplit(
  universeId: string,
  room: Room | null,
  allCharacters: Character[],
  singleRoomId: (characterId: string) => string,
  callbacks: {
    onSplit: (updatedOwnRoom: Room) => void;
    clearError: () => void;
    onError: (message: string) => void;
  }
) {
  const [splitMode, setSplitMode] = useState(false);
  const [splitIndex, setSplitIndex] = useState<number | null>(null);
  const [splitTargetId, setSplitTargetId] = useState("");
  const [splitting, setSplitting] = useState(false);
  const [splitDone, setSplitDone] = useState<SplitDone | null>(null);

  function toggleSplitMode() {
    setSplitMode((v) => !v);
    setSplitIndex(null);
    setSplitTargetId("");
    setSplitDone(null);
  }

  function pickSplitPoint(i: number) {
    setSplitIndex(i);
    setSplitTargetId("");
  }

  function cancelSplitPoint() {
    setSplitIndex(null);
  }

  async function confirmSplit() {
    if (splitIndex === null || !splitTargetId || splitting || !room) return;
    const target = allCharacters.find((c) => c.id === splitTargetId);
    if (!target) return;
    setSplitting(true);
    callbacks.clearError();
    try {
      const head = room.items.slice(0, splitIndex);
      const tail = room.items.slice(splitIndex);
      const now = Date.now();
      const targetExisting = await getRoomForCharacter(
        universeId,
        splitTargetId
      ).catch(() => null);
      const targetRoom: Room = targetExisting
        ? { ...targetExisting, items: [...targetExisting.items, ...tail], updatedAt: now }
        : {
            id: singleRoomId(splitTargetId),
            universeId,
            kind: "single",
            characterIds: [splitTargetId],
            items: tail,
            createdAt: now,
            updatedAt: now,
          };
      await saveRoom(targetRoom);
      const updatedOwnRoom: Room = { ...room, items: head, updatedAt: now };
      await saveRoom(updatedOwnRoom);
      callbacks.onSplit(updatedOwnRoom);
      setSplitIndex(null);
      setSplitTargetId("");
      setSplitMode(false);
      setSplitDone({ name: target.name, targetId: target.id });
    } catch (err) {
      callbacks.onError(storageErrorMessage(err, "대화를 옮기지 못했어요."));
    } finally {
      setSplitting(false);
    }
  }

  return {
    splitMode,
    splitIndex,
    splitTargetId,
    splitting,
    splitDone,
    setSplitTargetId,
    toggleSplitMode,
    pickSplitPoint,
    cancelSplitPoint,
    confirmSplit,
  };
}
