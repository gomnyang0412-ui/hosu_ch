"use client";

import {
  CalendarIcon,
  ClockIcon,
  EditIcon,
  ScissorsIcon,
  TheaterMasksIcon,
  UndoIcon,
} from "@/components/icons";

/** 1:1 채팅방 메뉴. 각 항목의 동작은 전부 부모가 주는 콜백에 그대로 위임한다 */
export default function ChatMenu({
  open,
  onClose,
  canPickRole,
  onRename,
  onPickRole,
  onShowTimeline,
  onToggleSplit,
  onOpenBackups,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  canPickRole: boolean;
  onRename: () => void;
  onPickRole: () => void;
  onShowTimeline: () => void;
  onToggleSplit: () => void;
  onOpenBackups: () => void;
  onReset: () => void;
}) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="메뉴 닫기"
        onClick={onClose}
        className="fixed inset-0 z-10 cursor-default"
      />
      <div className="card-shadow fixed right-3 top-14 z-20 flex w-56 flex-col overflow-hidden rounded-2xl glass">
        <button
          type="button"
          onClick={onRename}
          className="flex items-center gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-background"
        >
          <EditIcon /> 채팅방 이름 바꾸기
        </button>
        {canPickRole && (
          <button
            type="button"
            onClick={onPickRole}
            className="flex items-center gap-2 border-t border-border px-4 py-3 text-left text-sm transition-colors hover:bg-background"
          >
            <TheaterMasksIcon /> 역할 바꾸기 (AI / 나)
          </button>
        )}
        <button
          type="button"
          onClick={onShowTimeline}
          className="flex items-center gap-2 border-t border-border px-4 py-3 text-left text-sm transition-colors hover:bg-background"
        >
          <CalendarIcon /> 날짜별로 이동
        </button>
        <button
          type="button"
          onClick={onToggleSplit}
          className="flex items-center gap-2 border-t border-border px-4 py-3 text-left text-sm transition-colors hover:bg-background"
        >
          <ScissorsIcon /> 대화 나누기
        </button>
        <button
          type="button"
          onClick={onOpenBackups}
          className="flex items-center gap-2 border-t border-border px-4 py-3 text-left text-sm transition-colors hover:bg-background"
        >
          <ClockIcon /> 이전 기록으로 되돌리기
        </button>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-2 border-t border-border px-4 py-3 text-left text-sm text-red-600 transition-colors hover:bg-background"
        >
          <UndoIcon /> 대화 초기화
        </button>
      </div>
    </>
  );
}
