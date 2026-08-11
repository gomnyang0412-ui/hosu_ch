"use client";

import { useEffect, useRef, type TextareaHTMLAttributes } from "react";

type Props = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "rows"
> & {
  value: string;
  onChange: (value: string) => void;
  /** 이 높이(px)를 넘어가면 더는 늘어나지 않고 내부 스크롤로 바뀐다 */
  maxHeightPx?: number;
};

/** 줄바꿈이든 자동 줄바꿈이든 내용이 길어지는 만큼 위로 자연스럽게 늘어나는 textarea */
export default function AutoGrowTextarea({
  value,
  onChange,
  maxHeightPx = 160,
  style,
  ...rest
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeightPx)}px`;
  }, [value, maxHeightPx]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      style={{ ...style, maxHeight: maxHeightPx, overflowY: "auto" }}
      {...rest}
    />
  );
}
