// 서버 전용: 상태는 한 요청의 스트림으로 보내고, 생성 결과는 저장 후 전달한다.
import { after } from "next/server";
import { geminiErrorResponse } from "./gemini";
import type { GenerationProgress, SceneResult, SceneStreamEvent } from "./types";

export function sceneStreamResponse(
  run: (report: (progress: GenerationProgress) => void) => Promise<SceneResult>
): Response {
  const encoder = new TextEncoder();
  let disconnected = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let work: Promise<void> = Promise.resolve();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: SceneStreamEvent) => {
        if (disconnected) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          disconnected = true;
          clearInterval(heartbeat);
        }
      };
      send({ type: "ping" });
      heartbeat = setInterval(() => send({ type: "ping" }), 10_000);
      work = (async () => {
        try {
          const result = await run((progress) => send({ type: "progress", progress }));
          send({ type: "result", result });
        } catch (err) {
          const failure = await geminiErrorResponse(err).json();
          send({ type: "error", error: failure.error, kind: failure.kind });
        } finally {
          clearInterval(heartbeat);
          if (!disconnected) {
            try { controller.close(); } catch { /* 연결이 끊겨도 저장은 완료된 상태다. */ }
          }
        }
      })();
    },
    cancel() {
      disconnected = true;
      clearInterval(heartbeat);
      // 화면의 취소를 이미 시작한 생성의 중단으로 전달하지 않는다.
    },
  });
  // 탭을 닫아도 이미 시작한 생성·저장이 끝날 때까지 플랫폼의
  // maxDuration 안에서 실행을 유지한다. 연결 종료만으로 결과를 버리지 않는다.
  after(() => work);
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
