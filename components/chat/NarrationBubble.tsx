import { TrashIcon } from "@/components/icons";

/** 지문(상황·심리 묘사) 한 줄. 1:1 채팅과 멀티 대화방이 똑같이 쓰던 렌더링을 하나로 모은 것 */
export default function NarrationBubble({
  text,
  onDelete,
}: {
  text: string;
  /** 1:1 대화방은 항상 넘겨서 지문 하나하나를 지울 수 있게 한다(자동
   *  요약이 쌓여도 직접 정리할 수 있도록). 멀티 대화방은 지금까지
   *  넘긴 적 없음 — 안 넘기면 삭제 버튼 없이 예전처럼 렌더링된다. */
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <p className="flex-1 border-l-2 border-border pl-3 text-[13px] italic leading-relaxed text-muted">
        {text}
      </p>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="자동 요약 지우기"
          title="자동 요약 지우기"
          className="shrink-0 text-muted opacity-50 transition-transform hover:scale-110 hover:text-red-600 hover:opacity-100"
        >
          <TrashIcon />
        </button>
      )}
    </div>
  );
}
