"use client";

import { formatDateLabel, type DateGroup } from "@/lib/chatDates";

export default function TimelinePanel({
  open,
  groups,
  onJump,
  onClose,
}: {
  open: boolean;
  groups: DateGroup[];
  onJump: (date: string) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-black/30"
      />
      <div className="card-shadow fixed inset-x-3 top-16 bottom-16 z-40 flex flex-col overflow-hidden rounded-2xl glass lg:inset-x-auto lg:left-1/2 lg:w-96 lg:-translate-x-1/2">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">날짜별로 이동</p>
          <button type="button" onClick={onClose} className="text-sm text-muted">
            닫기
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto p-2">
          {[...groups].reverse().map((g) => (
            <li key={g.date}>
              <button
                type="button"
                onClick={() => onJump(g.date)}
                className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left hover:bg-background"
              >
                <span className="text-sm font-medium">{formatDateLabel(g.date)}</span>
                <span className="w-full truncate text-xs text-muted">
                  {g.preview || "…"} · {g.count}개
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
