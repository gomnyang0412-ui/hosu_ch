/** AI 호출 실패 시 뜨는 에러 배너 + 다시 시도 버튼. 1:1/멀티 공통 */
export default function ErrorRetryBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium"
      >
        다시 시도
      </button>
    </div>
  );
}
