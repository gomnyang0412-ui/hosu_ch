export default function GenerationStatus({ message, previous }: { message: string; previous: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="text-center text-xs leading-relaxed text-muted">
      <p>{message || "작성 준비 중…"}</p>
      {previous && <p className="mt-1 text-[11px] text-muted/70">직전 시도: {previous}</p>}
    </div>
  );
}
