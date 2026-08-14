// 멀티 대화방(ThreadItem[]) 관련 유틸.
// AI가 새로 만드는 지문/대사는 관찰 모드와 같은 형식(SceneItem)이라
// 파싱은 lib/scene.ts의 parseSceneItems를 그대로 재사용한다.
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
