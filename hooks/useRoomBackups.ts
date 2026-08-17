import { useState } from "react";
import { getRoomBackups, restoreRoomBackup, StorageError } from "@/lib/storage";
import type { Room } from "@/lib/types";

/**
 * 채팅방 백업 목록 열기/복원. 1:1 채팅과 멀티 대화방이 거의 그대로
 * 복붙해 쓰던 로직을 하나로 모은 것 — 방을 식별하는 universeId/roomId와
 * 복원 성공 시 그 방 상태를 반영할 콜백만 페이지별로 다르게 넘긴다.
 */
export function useRoomBackups(
  universeId: string,
  roomId: string,
  callbacks: {
    onRestored: (room: Room) => void;
    clearError: () => void;
    onError: (message: string) => void;
  }
) {
  const [backups, setBackups] = useState<{ value: Room; ts: number }[] | null>(
    null
  );
  const [restoring, setRestoring] = useState(false);

  async function openBackups() {
    callbacks.clearError();
    try {
      const list = await getRoomBackups(universeId, roomId);
      setBackups(list);
    } catch (err) {
      callbacks.onError(
        err instanceof StorageError ? err.message : "이전 기록을 불러오지 못했어요."
      );
    }
  }

  async function restoreBackup(index: number) {
    if (restoring) return;
    setRestoring(true);
    callbacks.clearError();
    try {
      const restored = await restoreRoomBackup(universeId, roomId, index);
      callbacks.onRestored(restored);
      setBackups(null);
    } catch (err) {
      callbacks.onError(
        err instanceof StorageError ? err.message : "이전 기록으로 되돌리지 못했어요."
      );
    } finally {
      setRestoring(false);
    }
  }

  function closeBackups() {
    setBackups(null);
  }

  return { backups, restoring, openBackups, restoreBackup, closeBackups };
}
