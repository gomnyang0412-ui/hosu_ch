/** CharacterForm/UniverseForm에서 반복되던 "라벨 + 입력칸" 한 벌.
 *  rows를 주면 textarea, 안 주면 input을 렌더링한다. 라벨 스타일이나
 *  힌트 문구가 다른 특수한 필드(관계 슬롯 등)는 여기 억지로 맞추지
 *  않고 각 폼에서 그대로 직접 작성한다. */
export function FormField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  rows,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const inputClassName = `rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-primary/50${
    rows ? " leading-relaxed" : ""
  }`;
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {hint && <p className="-mt-1 text-xs text-muted">{hint}</p>}
      {rows ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className={inputClassName}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={inputClassName}
        />
      )}
    </label>
  );
}
