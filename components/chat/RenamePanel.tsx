"use client";

export default function RenamePanel({
  open,
  value,
  onChange,
  onCancel,
  onConfirm,
  saving,
}: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  if (!open) return null;

  return (
    <div className="flex items-center gap-2 border-b border-border glass px-3 py-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
        placeholder="채팅방 이름"
        className="min-w-0 flex-1 rounded-xl border border-border bg-background p-2 text-sm outline-none focus:border-primary/50"
      />
      <button
        type="button"
        onClick={onCancel}
        className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted"
      >
        취소
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={!value.trim() || saving}
        className="gradient-primary rounded-full px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
      >
        {saving ? "저장 중…" : "저장"}
      </button>
    </div>
  );
}
