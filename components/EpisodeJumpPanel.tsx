"use client";

import { useState } from "react";
import { ChevronRightIcon, ClapperIcon, StarIcon } from "@/components/icons";
import type { StoryEpisode } from "@/lib/types";

export function episodeAnchorId(index: number): string {
  return `episode-${index}`;
}

// 화가 많이 쌓인 이야기(예: 100화 이상)에서 목록을 한 번에 쭉 스크롤해야
// 하면 원하는 화를 찾기 번거로워서, 일정 개수를 넘으면 구간별로 묶어
// 접었다 펼 수 있게 한다. 화가 적은 이야기는 지금처럼 평평한 목록 그대로.
const GROUP_THRESHOLD = 30;
const GROUP_SIZE = 20;

interface Group {
  key: number;
  label: string;
  episodes: StoryEpisode[];
}

function buildGroups(items: StoryEpisode[]): Group[] {
  const byBucket = new Map<number, StoryEpisode[]>();
  for (const ep of items) {
    const bucket = Math.floor((ep.index - 1) / GROUP_SIZE);
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket)!.push(ep);
  }
  return [...byBucket.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([bucket, episodes]) => ({
      key: bucket,
      label: `${bucket * GROUP_SIZE + 1}~${bucket * GROUP_SIZE + GROUP_SIZE}화`,
      episodes,
    }));
}

function EpisodeRow({
  ep,
  onJump,
}: {
  ep: StoryEpisode;
  onJump: (index: number) => void;
}) {
  return (
    <li>
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
  );
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
  const [expandedGroups, setExpandedGroups] = useState<Set<number> | null>(null);

  if (!open) return null;

  const hasBookmarks = episodes.some((ep) => ep.bookmarked);
  const list = [...episodes]
    .filter((ep) => !onlyBookmarked || ep.bookmarked)
    .reverse();

  const groups = episodes.length > GROUP_THRESHOLD ? buildGroups(list) : null;
  const effectiveExpanded =
    expandedGroups ?? new Set(groups && groups[0] ? [groups[0].key] : []);

  function toggleGroup(key: number) {
    setExpandedGroups((prev) => {
      const base = prev ?? new Set(groups && groups[0] ? [groups[0].key] : []);
      const next = new Set(base);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
          ) : groups ? (
            groups.map((group) => {
              const isExpanded = effectiveExpanded.has(group.key);
              return (
                <li key={group.key} className="mb-1">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-background"
                  >
                    <span>
                      {group.label}{" "}
                      <span className="text-xs font-normal text-muted">
                        ({group.episodes.length}화)
                      </span>
                    </span>
                    <ChevronRightIcon
                      className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    />
                  </button>
                  {isExpanded && (
                    <ul className="pl-2">
                      {group.episodes.map((ep) => (
                        <EpisodeRow key={ep.index} ep={ep} onJump={onJump} />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })
          ) : (
            list.map((ep) => <EpisodeRow key={ep.index} ep={ep} onJump={onJump} />)
          )}
        </ul>
      </div>
    </>
  );
}
