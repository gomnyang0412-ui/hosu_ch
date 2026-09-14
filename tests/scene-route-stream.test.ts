import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), save: vi.fn(), after: vi.fn(), get: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/db", () => ({ getStory: mocks.get, saveStory: mocks.save, recordApiUsage: vi.fn() }));
vi.mock("@/lib/gemini", async (original) => ({ ...await original<typeof import("@/lib/gemini")>(), generateStoryEpisode: mocks.generate }));
import { POST } from "@/app/api/scene/route";
import { GeminiRequestError } from "@/lib/gemini";
import { createOrgUniverse } from "@/lib/types";
import { readSceneResponse } from "@/lib/sceneProgress";

function request(stream = true) {
  return new Request("http://localhost/api/scene", { method: "POST", headers: {
    "Content-Type": "application/json", ...(stream ? { Accept: "application/x-ndjson" } : {}),
  }, body: JSON.stringify({ characters: [{ name: "가" }, { name: "나" }], universe: createOrgUniverse(), topic: "밤", characterIds: ["a", "b"] }) });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const generated = { text: "조용한 밤이었다.", model: "gemini-3.8-flash", keyIndex: 2 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue(undefined);
  mocks.generate.mockResolvedValue(generated);
});
describe("scene progress route", () => {
  it("delivers live status before generation finishes and result only after saving", async () => {
    const generation = deferred<typeof generated>();
    const saving = deferred<void>();
    mocks.generate.mockImplementation(({ onProgress }) => {
      onProgress({ phase: "attempt", model: generated.model, keyIndex: 2 });
      return generation.promise;
    });
    mocks.save.mockReturnValue(saving.promise);
    const res = await POST(request());
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const reader = res.body!.getReader();
    const decode = (value?: Uint8Array) => JSON.parse(new TextDecoder().decode(value));
    expect(decode((await reader.read()).value).type).toBe("ping");
    expect(decode((await reader.read()).value).progress).toMatchObject({ phase: "attempt", keyIndex: 2 });
    expect(mocks.save).not.toHaveBeenCalled();
    generation.resolve(generated);
    expect(decode((await reader.read()).value).progress.phase).toBe("saving");
    expect(mocks.save).toHaveBeenCalledOnce();
    const settled = vi.fn();
    const last = reader.read().then((chunk) => { settled(); return chunk; });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    saving.resolve();
    expect(decode((await last).value)).toMatchObject({ type: "result", result: { episode: { text: generated.text } } });
    await mocks.after.mock.calls[0][0]();
    reader.releaseLock();
  });
  it("finishes saving after the reader disconnects", async () => {
    const generation = deferred<typeof generated>();
    mocks.generate.mockReturnValue(generation.promise);
    const res = await POST(request());
    await res.body!.cancel();
    generation.resolve(generated);
    await mocks.after.mock.calls[0][0]();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls[0][0].episodes[0].text).toBe(generated.text);
  });
  it("sends generation failures through the stream without saving", async () => {
    mocks.generate.mockRejectedValue(new GeminiRequestError("한도 도달", "quota"));
    await expect(readSceneResponse(await POST(request()), vi.fn())).rejects.toMatchObject({ kind: "quota" });
    expect(mocks.save).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
  });
  it("keeps the old JSON response for an already-open client", async () => {
    const res = await POST(request(false));
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ episode: { text: generated.text }, session: { topic: "밤" } });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it("does not send a successful result when saving fails", async () => {
    mocks.save.mockRejectedValueOnce(new Error("저장 실패"));
    const report = vi.fn();
    await expect(readSceneResponse(await POST(request()), report)).rejects.toMatchObject({ message: "저장 실패" });
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ phase: "saving" }));
    await mocks.after.mock.calls[0][0]();
  });
});
