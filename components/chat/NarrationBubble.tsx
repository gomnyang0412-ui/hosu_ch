/** 지문(상황·심리 묘사) 한 줄. 1:1 채팅과 멀티 대화방이 똑같이 쓰던 렌더링을 하나로 모은 것 */
export default function NarrationBubble({ text }: { text: string }) {
  return (
    <p className="border-l-2 border-border pl-3 text-[13px] italic leading-relaxed text-muted">
      {text}
    </p>
  );
}
