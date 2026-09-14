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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubEnv("GEMINI_API_KEY", "test1,test2,test3,test4");
  mocks.call.mockReset(); mocks.usage.mockReset(); mocks.usage.mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Gemini retry routing", () => {
  it("429 tries another project key on the same model", async () => {
    mocks.call.mockRejectedValueOnce(quota()).mockResolvedValue(success);
    const pending = generateStoryEpisode(input);
    await vi.runAllTimersAsync();
    expect((await pending).keyIndex).toBe(2);
    expect(calls()).toEqual([["test1", "gemini-3.8-flash"], ["test2", "gemini-3.8-flash"]]);
  });
  it("a full chat timeout tries the next Flash within the remaining budget", async () => {
    mocks.call.mockImplementationOnce(() => { vi.setSystemTime(15001); throw timeout(); }).mockResolvedValue(success);
    const signalSpy = vi.spyOn(AbortSignal, "timeout");
    expect((await generateChatReply(input)).model).toBe("gemini-3.7-flash");
    expect(calls()).toEqual([["test1", "gemini-3.8-flash"], ["test1", "gemini-3.7-flash"]]);
    expect(signalSpy.mock.calls.map(([ms]) => ms)).toEqual([15000, 12999]);
  });
  it("observation timeouts never fall back to Lite", async () => {
    mocks.call.mockRejectedValue(timeout());
    await expect(generateStoryEpisode(input)).rejects.toMatchObject({ kind: "network" });
    expect(calls()).toHaveLength(5);
    expect(calls().every(([key, model]) => key === "test1" && !model.includes("lite"))).toBe(true);
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
