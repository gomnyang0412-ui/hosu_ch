"use client";

import type { StoryEpisode } from "@/lib/types";

export function episodeAnchorId(index: number): string {
  return `episode-${index}`;
}

export default function EpisodeJumpPanel({
  open,
  episodes,
  onJump,
  onClose,
}: {
  open: boolean;
  episodes: StoryEpisode[];
  onJump: (index: number) => void;
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
          <p className="text-sm font-semibold">화별로 이동</p>
          <button type="button" onClick={onClose} className="text-sm text-muted">
            닫기
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto p-2">
          {[...episodes].reverse().map((ep) => (
            <li key={ep.index}>
              <button
                type="button"
                onClick={() => onJump(ep.index)}
                className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left hover:bg-background"
              >
                <span className="text-sm font-medium">{ep.index}화</span>
                <span className="w-full truncate text-xs text-muted">
                  {ep.directive ? `🎬 ${ep.directive}` : ep.text.trim().slice(0, 40) || "…"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
