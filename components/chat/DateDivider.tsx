import { dateAnchorId, formatDateLabel } from "@/lib/chatDates";

/** 대화 목록 중간에 날짜가 바뀔 때 보여주는 구분선. 1:1 채팅과 멀티
 *  대화방이 완전히 동일한 마크업을 각자 갖고 있던 걸 하나로 모은 것 */
export default function DateDivider({ date }: { date: string }) {
  return (
    <div
      id={dateAnchorId(date)}
      className="my-1 flex items-center justify-center scroll-mt-20"
    >
      <span className="rounded-full bg-card px-3 py-1 text-[11px] font-medium text-muted">
        {formatDateLabel(date)}
      </span>
    </div>
  );
}
