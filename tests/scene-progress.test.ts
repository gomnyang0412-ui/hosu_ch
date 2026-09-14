import { describe, expect, it, vi } from "vitest";
import { generationProgressLabel, readSceneResponse } from "@/lib/sceneProgress";
import type { SceneResult, SceneStreamEvent } from "@/lib/types";

const result: SceneResult = {
  episode: { index: 1, text: "한글이 끊기지 않고 전달된다." },
  session: { id: "s", universeId: "org", characterIds: ["a", "b"], topic: "밤", createdAt: 1, updatedAt: 2 },
};
function response(events: SceneStreamEvent[], trailingNewline = true) {
  const bytes = new TextEncoder().encode(events.map((e) => JSON.stringify(e)).join("\n") + (trailingNewline ? "\n" : ""));
  return new Response(new ReadableStream({ start(controller) {
    // UTF-8 한글 한 글자 중간에서도 네트워크 청크가 갈라지는 상황.
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } }), { headers: { "Content-Type": "application/x-ndjson" } });
}
describe("scene stream reader", () => {
  it("reads fragmented Korean and a final line without a newline", async () => {
    const progress = { phase: "attempt" as const, model: "gemini-3.8-flash", keyIndex: 2 };
    const report = vi.fn();
    expect(await readSceneResponse(response([
      { type: "ping" }, { type: "progress", progress }, { type: "result", result },
    ], false), report)).toEqual(result);
    expect(report).toHaveBeenCalledExactlyOnceWith(progress);
    expect(generationProgressLabel(progress)).toBe("Gemini 3.8 Flash · 키2 · 응답 대기 중");
  });
  it("preserves an error sent after HTTP 200", async () => {
    await expect(readSceneResponse(response([{ type: "error", error: "한도 도달", kind: "quota" }]), vi.fn()))
      .rejects.toMatchObject({ message: "한도 도달", kind: "quota" });
  });
  it("does not mistake an interrupted stream for a saved result", async () => {
    await expect(readSceneResponse(response([{ type: "ping" }]), vi.fn())).rejects.toThrow("without a saved result");
  });
  it("still accepts JSON responses and HTTP validation errors", async () => {
    expect(await readSceneResponse(Response.json(result), vi.fn())).toEqual(result);
    await expect(readSceneResponse(Response.json({ error: "잘못된 요청", kind: "unknown" }, { status: 400 }), vi.fn()))
      .rejects.toMatchObject({ kind: "unknown", message: "잘못된 요청" });
  });
});
