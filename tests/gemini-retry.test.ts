import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@google/genai";

const mocks = vi.hoisted(() => ({ call: vi.fn(), usage: vi.fn() }));
vi.mock("@/lib/db", () => ({ recordApiUsage: mocks.usage }));
vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return { ...actual, GoogleGenAI: class {
    models;
    constructor({ apiKey }: { apiKey: string }) {
      this.models = { generateContent: (params: { model: string }) => mocks.call(apiKey, params) };
    }
  } };
});
import { generateChatReply, generateStoryEpisode, generateObservationRecap } from "@/lib/gemini";
const input = { systemInstruction: "test", contents: [] };
const quota = () => new ApiError({ status: 429, message: "RequestsPerMinute" });
const unavailable = () => new ApiError({ status: 404, message: "missing" });
const timeout = () => new DOMException("timeout", "TimeoutError");
const success = { text: "ok" };
const calls = () => mocks.call.mock.calls.map(([key, p]) => [key, p.model]);
const groqResponse = (model = "qwen/qwen3.8-27b") => new Response(JSON.stringify({
  choices: [{ message: { content: "ok" }, finish_reason: "stop", model }],
}), { status: 200, headers: { "Content-Type": "application/json" } });
const groqError = (status: number) => new Response(JSON.stringify({
  error: { message: "test error", type: "test" },
}), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "test1,test2,test3,test4");
  mocks.call.mockReset(); mocks.usage.mockReset(); mocks.usage.mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Groq preferred routing", () => {
  it("uses Qwen first without calling Gemini", async () => {
    vi.stubEnv("GROQ_API_KEY", "groq1");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(groqResponse());

    expect(await generateChatReply(input)).toMatchObject({
      text: "ok",
      model: "qwen/qwen3.8-27b",
      keyIndex: 1,
    });
    expect(mocks.call).not.toHaveBeenCalled();
    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(request.model).toBe("qwen/qwen3.8-27b");
    expect(request.reasoning_format).toBe("hidden");
    expect(request.max_completion_tokens).toBe(1024);
    expect(request.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        strict: false,
        schema: { type: "object", properties: { say: { type: "string" } } },
      },
    });
  });

  it("falls back from Qwen quota to GPT-OSS", async () => {
    vi.stubEnv("GROQ_API_KEY", "groq1");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(groqError(429))
      .mockResolvedValueOnce(groqResponse("openai/gpt-oss-120b"));

    expect(await generateChatReply(input)).toMatchObject({
      model: "openai/gpt-oss-120b",
      keyIndex: 1,
    });
    expect(fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(init?.body as string).model
    )).toEqual(["qwen/qwen3.8-27b", "openai/gpt-oss-120b"]);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("keeps the existing Gemini chain after both Groq models fail", async () => {
    vi.stubEnv("GROQ_API_KEY", "groq1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(groqError(429));
    mocks.call.mockResolvedValue(success);

    expect(await generateChatReply(input)).toMatchObject({
      model: "gemini-3.8-flash",
      keyIndex: 1,
    });
    expect(calls()).toEqual([["test1", "gemini-3.8-flash"]]);
  });

  it("skips the equally limited second Groq model and uses Gemini on 413", async () => {
    vi.stubEnv("GROQ_API_KEY", "groq1");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(groqError(413));
    mocks.call.mockResolvedValue(success);

    expect(await generateChatReply(input)).toMatchObject({
      model: "gemini-3.8-flash",
      keyIndex: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls()).toEqual([["test1", "gemini-3.8-flash"]]);
  });

  it("does not hide a non-retryable Groq configuration error", async () => {
    vi.stubEnv("GROQ_API_KEY", "bad-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(groqError(401));

    await expect(generateChatReply(input)).rejects.toMatchObject({ kind: "unknown" });
    expect(mocks.call).not.toHaveBeenCalled();
  });
});

describe("Gemini retry routing", () => {
  it("429 tries another project key on the same model", async () => {
    mocks.call.mockRejectedValueOnce(quota()).mockResolvedValue(success);
    const progress = vi.fn();
    const pending = generateStoryEpisode({ ...input, onProgress: progress });
    await vi.runAllTimersAsync();
    expect((await pending).keyIndex).toBe(2);
    expect(calls()).toEqual([["test1", "gemini-3.8-flash"], ["test2", "gemini-3.8-flash"]]);
    expect(progress.mock.calls.map(([p]) => [p.phase, p.keyIndex, p.reason])).toEqual([
      ["attempt", 1, undefined], ["retry", 1, "quota"], ["attempt", 2, undefined], ["generated", 2, undefined],
    ]);
  });
  it("a full chat timeout tries the next key on the same Flash", async () => {
    mocks.call.mockImplementationOnce(() => { vi.setSystemTime(15001); throw timeout(); }).mockResolvedValue(success);
    const signalSpy = vi.spyOn(AbortSignal, "timeout");
    expect(await generateChatReply(input)).toMatchObject({ model: "gemini-3.8-flash", keyIndex: 2 });
    expect(calls()).toEqual([["test1", "gemini-3.8-flash"], ["test2", "gemini-3.8-flash"]]);
    expect(signalSpy.mock.calls.map(([ms]) => ms)).toEqual([15000, 12999]);
  });
  it("observation timeouts exhaust each Flash's keys before the next model", async () => {
    mocks.call.mockRejectedValue(timeout());
    const pending = generateStoryEpisode(input);
    const rejection = expect(pending).rejects.toMatchObject({ kind: "network" });
    await vi.runAllTimersAsync();
    await rejection;
    expect(calls().slice(0, 8)).toEqual([
      ["test1", "gemini-3.8-flash"], ["test2", "gemini-3.8-flash"],
      ["test3", "gemini-3.8-flash"], ["test4", "gemini-3.8-flash"],
      ["test1", "gemini-3.7-flash"], ["test2", "gemini-3.7-flash"],
      ["test3", "gemini-3.7-flash"], ["test4", "gemini-3.7-flash"],
    ]);
    expect(calls().every(([, model]) => !model.includes("lite"))).toBe(true);
  });
  it("404 tries another project key before falling back to an older model", async () => {
    mocks.call.mockRejectedValueOnce(unavailable()).mockResolvedValue(success);
    expect(await generateChatReply(input)).toMatchObject({ model: "gemini-3.8-flash", keyIndex: 2 });
    expect(calls()).toEqual([["test1", "gemini-3.8-flash"], ["test2", "gemini-3.8-flash"]]);
  });
  it("Lite gets another key after a quick quota error", async () => {
    mocks.call.mockImplementation((key, { model }) => {
      if (!model.includes("lite")) throw unavailable();
      if (key === "test1") { vi.setSystemTime(Date.now() + 200); throw quota(); }
      return success;
    });
    const result = await generateChatReply(input);
    expect(result).toMatchObject({ model: "gemini-3.5-flash-lite", keyIndex: 2 });
  });
  it("Lite gets another model after a 404 even with elapsed overhead", async () => {
    mocks.call.mockImplementation((_key, { model }) => {
      vi.setSystemTime(Date.now() + 10);
      if (model !== "gemini-3.1-flash-lite") throw unavailable();
      return success;
    });
    expect((await generateChatReply(input)).model).toBe("gemini-3.1-flash-lite");
  });
  it("non-retryable errors are not hidden by a Lite call", async () => {
    mocks.call.mockRejectedValue(new ApiError({ status: 400, message: "bad input" }));
    await expect(generateChatReply(input)).rejects.toMatchObject({ kind: "unknown" });
    expect(calls()).toHaveLength(1);
  });
  it("recap Lite can rotate project keys too", async () => {
    mocks.call.mockImplementation((key, { model }) => {
      if (!model.includes("lite")) throw unavailable();
      if (key === "test1") { vi.setSystemTime(Date.now() + 100); throw quota(); }
      return success;
    });
    expect(await generateObservationRecap(input)).toBe("ok");
    expect(calls().at(-1)).toEqual(["test2", "gemini-3.5-flash-lite"]);
  });
});
