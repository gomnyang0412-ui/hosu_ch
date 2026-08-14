"use client";

import type { Room } from "@/lib/types";

export default function BackupPanel({
  backups,
  restoring,
  onRestore,
  onClose,
}: {
  backups: { value: Room; ts: number }[] | null;
  restoring: boolean;
  onRestore: (index: number) => void;
  onClose: () => void;
}) {
  if (!backups) return null;

  return (
    <div className="flex flex-col gap-2 border-b border-border glass px-3 py-3">
      <p className="text-xs text-muted">
        저장될 때마다 직전 상태가 최근 5개까지 남아요. 되돌리고 싶은 시점을
        골라주세요.
      </p>
      {backups.length === 0 ? (
        <p className="text-sm text-muted">되돌릴 수 있는 이전 기록이 없어요.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {backups.map((b, i) => (
            <li key={b.ts}>
              <button
                type="button"
                onClick={() => onRestore(i)}
                disabled={restoring}
                className="card-shadow flex w-full items-center justify-between rounded-xl bg-background px-3 py-2 text-left text-sm disabled:opacity-40"
              >
                <span>
                  {new Date(b.ts).toLocaleString("ko-KR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
                <span className="text-xs text-muted">
                  메시지 {b.value.items.length}개 · 되돌리기
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onClose}
        className="self-end rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted"
      >
        닫기
      </button>
    </div>
  );
}
