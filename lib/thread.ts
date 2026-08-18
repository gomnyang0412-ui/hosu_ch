// 멀티 대화방(ThreadItem[]) 관련 유틸. 구버전 데이터 마이그레이션/
// 백업 호환을 위해 유지한다.
import type { ThreadItem } from "./types";

/** 이전 대화 내용을 AI에게 다시 보여줄 때 쓰는 텍스트 표현 */
export function serializeThreadItems(items: ThreadItem[]): string {
  return items
    .map((item) => {
      switch (item.t) {
        case "n":
          return `(지문) ${item.text}`;
        case "d":
          return `${item.who}${item.act ? ` (${item.act})` : ""}: ${item.say}`;
        case "u":
          return `나: ${item.text}${item.image ? (item.text ? " " : "") + "[사진 첨부]" : ""}`;
        case "x":
          return `(상황 전환) ${item.text}`;
      }
    })
    .join("\n");
}
