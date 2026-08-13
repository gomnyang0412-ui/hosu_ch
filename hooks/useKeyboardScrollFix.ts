import { useEffect, useRef } from "react";

/**
 * 채팅 입력창을 fixed/sticky로 화면에 띄우려면 "키보드가 얼마나 가리는지"를
 * 알아야 하는데, dvh·visualViewport·VirtualKeyboard API 전부 이 기기·
 * 브라우저 조합에서는 신호를 안 준다. 그래서 입력창을 대화 목록의 마지막
 * 항목으로 그냥 두고, 포커스가 갈 때/새 메시지가 쌓일 때 페이지 자체를
 * 끝까지 스크롤하는 방식으로 우회한다. 1:1 채팅과 멀티 대화방이 각자
 * 똑같이 구현하고 있던 걸 하나로 모은 것뿐, 동작은 그대로다.
 */
export function useKeyboardScrollFix(autoScrollDeps: readonly unknown[]) {
  const bottomRef = useRef<HTMLDivElement>(null);

  function handleInputFocus() {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }, 300);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, autoScrollDeps);

  return { bottomRef, handleInputFocus };
}
