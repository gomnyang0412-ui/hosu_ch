/** 메시지/지시문 수정 중일 때 보여주는 입력창 + 취소/확인 버튼. 1:1
 *  채팅과 멀티 대화방이 거의 동일한 마크업을 각자 갖고 있던 걸 하나로
 *  모은 것 — 모서리 둥글기(rounded)와 줄 수(rows)만 화면별로 달랐다. */
export default function EditBox({
  value,
  onChange,
  onCancel,
  onConfirm,
  rows = 2,
  rounded = "rounded-2xl",
}: {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  rows?: number;
  rounded?: string;
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
        rows={rows}
        className={`w-full max-w-[75%] resize-none ${rounded} border border-foreground/30 bg-background px-3 py-2 text-sm leading-relaxed outline-none md:max-w-[420px]`}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted"
        >
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!value.trim()}
          className="gradient-primary rounded-full px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40"
        >
          수정하고 다시 받기
        </button>
      </div>
    </div>
  );
}
