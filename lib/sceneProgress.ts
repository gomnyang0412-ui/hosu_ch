import { sourceLabel } from "./modelLabel";
import type { GenerationProgress, SceneResult, SceneStreamEvent } from "./types";

export function generationProgressLabel(progress: GenerationProgress): string {
  const source = sourceLabel(progress.model, progress.keyIndex);
  switch (progress.phase) {
    case "attempt": return `${source} · 응답 대기 중`;
    case "generated": return `${source} · 생성 완료, 결과 정리 중`;
    case "saving": return `${source} · 이야기 저장 중`;
    case "retry": {
      const reasons = {
        quota: "요청 한도 도달",
        dailyQuota: "오늘 한도 소진",
        timeout: "응답 시간 초과",
        overloaded: "서버 혼잡",
        network: "연결 오류",
        unavailable: "모델 사용 불가",
        cooldown: "반복 지연으로 잠시 대기",
      };
      return `${source} · ${progress.reason ? reasons[progress.reason] : "다음 시도 준비 중"}`;
    }
    case "skip": {
      const reasons = {
        quota: "요청 한도로 건너뜀",
        dailyQuota: "오늘 한도 소진으로 건너뜀",
        timeout: "응답 시간 초과로 건너뜀",
        overloaded: "서버 혼잡으로 건너뜀",
        network: "연결 오류로 건너뜀",
        unavailable: "모델 사용 불가로 건너뜀",
        cooldown: "반복 지연 냉각 중이라 건너뜀",
      };
      return `${source} · ${progress.reason ? reasons[progress.reason] : "건너뜀"}`;
    }
  }
}

export class SceneResponseError extends Error {
  constructor(message: string, public kind: "quota" | "network" | "overloaded" | "unknown") {
    super(message);
  }
}

/** 네트워크 조각과 JSON 행의 경계는 다르므로, UTF-8 디코더와 행 버퍼를 유지한다. */
export async function readSceneResponse(
  response: Response,
  onProgress: (progress: GenerationProgress) => void
): Promise<SceneResult> {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const data = await response.json();
    if (!response.ok) throw new SceneResponseError(data.error ?? "이번 화를 만들지 못했어요.", data.kind ?? "unknown");
    return data as SceneResult;
  }
  if (!response.body) throw new Error("Missing response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consume = (line: string): SceneResult | undefined => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as SceneStreamEvent;
    if (event.type === "progress") onProgress(event.progress);
    if (event.type === "error") throw new SceneResponseError(event.error, event.kind);
    if (event.type === "result") return event.result;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const result = consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (result) return result;
      }
      if (done) {
        const result = consume(buffer);
        if (result) return result;
        // 200 응답이라도 결과 이벤트 없이 끊기면 성공으로 처리하지 않는다.
        throw new Error("Scene stream ended without a saved result");
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
