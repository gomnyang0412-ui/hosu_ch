"use client";

import { useState } from "react";
import { ClapperIcon, StarIcon } from "@/components/icons";
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
  const [onlyBookmarked, setOnlyBookmarked] = useState(false);

  if (!open) return null;

  const hasBookmarks = episodes.some((ep) => ep.bookmarked);
  const list = [...episodes]
    .filter((ep) => !onlyBookmarked || ep.bookmarked)
    .reverse();

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
          <div className="flex items-center gap-2">
            {hasBookmarks && (
              <button
                type="button"
                onClick={() => setOnlyBookmarked((v) => !v)}
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors transition-transform hover:scale-[1.03] active:scale-[0.97] ${
                  onlyBookmarked
                    ? "border-accent bg-accent/10 text-accent-strong"
                    : "border-border text-muted"
                }`}
              >
                <StarIcon filled={onlyBookmarked} /> 북마크만
              </button>
            )}
            <button type="button" onClick={onClose} className="text-sm text-muted">
              닫기
            </button>
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto p-2">
          {list.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-muted">
              북마크한 화가 없어요.
            </li>
          ) : (
            list.map((ep) => (
              <li key={ep.index}>
                <button
                  type="button"
                  onClick={() => onJump(ep.index)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-background"
                >
                  <span className="flex items-center gap-1 text-sm font-medium">
                    {ep.bookmarked && <StarIcon filled />}
                    {ep.index}화
                  </span>
                  <span className="flex w-full items-center gap-1 truncate text-xs text-muted">
                    {ep.directive ? (
                      <>
                        <ClapperIcon /> {ep.directive}
                      </>
                    ) : (
                      ep.text.trim().slice(0, 40) || "…"
                    )}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </>
  );
}
