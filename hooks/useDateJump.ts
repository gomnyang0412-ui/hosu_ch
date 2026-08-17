import { dateAnchorId } from "@/lib/chatDates";

/**
 * 타임라인 패널에서 날짜를 골랐을 때 그 지점으로 스크롤한다. 1:1 채팅과
 * 멀티 대화방이 완전히 동일한 로직을 각자 갖고 있던 걸 하나로 모은 것.
 */
export function useDateJump(closeTimeline: () => void) {
  function jumpToDate(date: string) {
    closeTimeline();
    // 패널 닫힘 애니메이션/리렌더와 겹치지 않게 한 틱 뒤에 스크롤한다.
    setTimeout(() => {
      document
        .getElementById(dateAnchorId(date))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  return jumpToDate;
}
