import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ThinkingLevel } from "@google/genai";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  usage: vi.fn(),
  usageRead: vi.fn(),
  cooldownsRead: vi.fn(),
  availabilityFailure: vi.fn(),
  availabilityClear: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  clearApiModelAvailabilityFailure: mocks.availabilityClear,
  getApiModelCooldowns: mocks.cooldownsRead,
  getApiUsage: mocks.usageRead,
  recordApiModelAvailabilityFailure: mocks.availabilityFailure,
  recordApiUsage: mocks.usage,
}));
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
const dailyQuota = () => new ApiError({ status: 429, message: "RequestsPerDay" });
const unavailable = () => new ApiError({ status: 404, message: "missing" });
const overloaded = () => new ApiError({ status: 503, message: "overloaded" });
const timeout = () => new DOMException("timeout", "TimeoutError");
const success = { text: "ok" };
const calls = () => mocks.call.mock.calls.map(([key, p]) => [key, p.model]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubEnv("GEMINI_API_KEY", "test1,test2,test3,test4");
  mocks.call.mockReset(); mocks.usage.mockReset(); mocks.usage.mockResolvedValue(undefined);
  mocks.usageRead.mockReset(); mocks.usageRead.mockResolvedValue([]);
  mocks.cooldownsRead.mockReset(); mocks.cooldownsRead.mockResolvedValue({});
  mocks.availabilityFailure.mockReset(); mocks.availabilityFailure.mockResolvedValue(undefined);
  mocks.availabilityClear.mockReset(); mocks.availabilityClear.mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Gemini retry routing", () => {
  it("429 tries another project key on the same model", async () => {
    mocks.call.mockRejectedValueOnce(quota()).mockResolvedValue(success);
    const progress = vi.fn();
    const pending = generateStoryEpisode({ ...input, onProgress: progress });
    await vi.runAllTimersAsync();
    expect((await pending).keyIndex).toBe(2);
    expect(calls()).toEqual([["test1", "gemini-3.8-flash"], ["test2", "gemini-3.8-flash"]]);
    expect(progress.mock.calls.map(([p]) => [p.phase, p.keyIndex, p.reason])).toEqual([
      ["attempt", 1, undefined], ["retry", 1, "rateQuota"], ["attempt", 2, undefined], ["generated", 2, undefined],
    ]);
  });
  it("rechecks protected 3.8 after every key hits a transient quota", async () => {
    mocks.call
      .mockRejectedValueOnce(quota())
      .mockRejectedValueOnce(quota())
      .mockRejectedValueOnce(quota())
      .mockRejectedValueOnce(quota())
      .mockResolvedValue(success);
    const pending = generateStoryEpisode(input);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ model: "gemini-3.8-flash", keyIndex: 1 });
    expect(calls()).toEqual([
      ["test1", "gemini-3.8-flash"],
      ["test2", "gemini-3.8-flash"],
      ["test3", "gemini-3.8-flash"],
      ["test4", "gemini-3.8-flash"],
      ["test1", "gemini-3.8-flash"],
    ]);
  });
  it("a full chat timeout tries the next key on the same Flash", async () => {
    mocks.call.mockImplementationOnce(() => { vi.setSystemTime(15001); throw timeout(); }).mockResolvedValue(success);
    const signalSpy = vi.spyOn(AbortSignal, "timeout");
    expect(await generateChatReply(input)).toMatchObject({ model: "gemini-3.8-flash", keyIndex: 2 });
    expect(calls()).toEqual([["test1", "gemini-3.8-flash"], ["test2", "gemini-3.8-flash"]]);
    expect(signalSpy.mock.calls.map(([ms]) => ms)).toEqual([15000, 12999]);
  });
  it("observation timeouts exhaust every key on 3.8 and 3.7 before lower fallbacks", async () => {
    mocks.call.mockRejectedValue(timeout());
    const signalSpy = vi.spyOn(AbortSignal, "timeout");
    const pending = generateStoryEpisode(input);
    const rejection = expect(pending).rejects.toMatchObject({ kind: "network" });
    await vi.runAllTimersAsync();
    await rejection;
    expect(calls()).toEqual([
      ["test1", "gemini-3.8-flash"],
      ["test2", "gemini-3.8-flash"],
      ["test3", "gemini-3.8-flash"],
      ["test4", "gemini-3.8-flash"],
      ["test1", "gemini-3.7-flash"],
      ["test2", "gemini-3.7-flash"],
      ["test3", "gemini-3.7-flash"],
      ["test4", "gemini-3.7-flash"],
      ["test1", "gemini-3.6-flash"],
      ["test1", "gemini-3.5-flash"],
      ["test1", "gemini-3-flash-preview"],
    ]);
    expect(signalSpy.mock.calls[0]?.[0]).toBe(40_000);
    expect(calls().every(([, model]) => !model.includes("lite"))).toBe(true);
    expect(mocks.usage).toHaveBeenCalledWith(
      "1969-12-31",
      1,
      "gemini-3.8-flash",
      "timeout"
    );
    expect(mocks.availabilityFailure).not.toHaveBeenCalledWith(
      "1969-12-31",
      "observation",
      "gemini-3.8-flash"
    );
    expect(mocks.availabilityFailure).toHaveBeenCalledWith(
      "1969-12-31",
      "observation",
      "gemini-3.6-flash"
    );
  });
  it("uses compact contents while continuing through protected 3.8 keys", async () => {
    const full = [{ role: "user" as const, parts: [{ text: "full" }] }];
    const compact = [{ role: "user" as const, parts: [{ text: "compact" }] }];
    mocks.call
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockResolvedValue(success);
    const pending = generateStoryEpisode({
      systemInstruction: "test",
      contents: full,
      fallbackContents: compact,
    });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ model: "gemini-3.8-flash", keyIndex: 3 });
    expect(mocks.call.mock.calls[0]?.[1].contents).toBe(full);
    expect(mocks.call.mock.calls[1]?.[1].contents).toBe(compact);
    expect(mocks.call.mock.calls[2]?.[1].contents).toBe(compact);
    expect(mocks.call.mock.calls[0]?.[1].config.thinkingConfig).toEqual({
      thinkingLevel: ThinkingLevel.LOW,
    });
    expect(mocks.call.mock.calls[1]?.[1].config.thinkingConfig).toEqual({
      thinkingLevel: ThinkingLevel.LOW,
    });
    expect(mocks.call.mock.calls[2]?.[1].config.thinkingConfig).toEqual({
      thinkingLevel: ThinkingLevel.LOW,
    });
  });
  it("records RequestsPerDay separately and tries the next project key", async () => {
    mocks.call.mockRejectedValueOnce(dailyQuota()).mockResolvedValue(success);
    const pending = generateStoryEpisode(input);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ model: "gemini-3.8-flash", keyIndex: 2 });
    expect(mocks.usage).toHaveBeenCalledWith(
      "1969-12-31",
      1,
      "gemini-3.8-flash",
      "dailyQuota"
    );
  });
  it("does not skip 3.8 from a stale hard-coded success count", async () => {
    mocks.usageRead.mockResolvedValue([
      { keyIndex: 1, model: "gemini-3.8-flash", success: 5, quota: 0, dailyQuota: 0 },
    ]);
    mocks.call.mockResolvedValue(success);
    expect(await generateStoryEpisode(input)).toMatchObject({
      model: "gemini-3.8-flash",
      keyIndex: 1,
    });
    expect(calls()).toEqual([["test1", "gemini-3.8-flash"]]);
  });
  it("skips keys only after the API reported an actual daily quota", async () => {
    mocks.usageRead.mockResolvedValue([
      { keyIndex: 1, model: "gemini-3.8-flash", success: 5, quota: 0, dailyQuota: 1 },
      { keyIndex: 2, model: "gemini-3.8-flash", success: 4, quota: 0, dailyQuota: 1 },
      { keyIndex: 3, model: "gemini-3.8-flash", success: 5, quota: 0, dailyQuota: 1 },
    ]);
    mocks.call.mockResolvedValue(success);
    const progress = vi.fn();
    expect(await generateStoryEpisode({ ...input, onProgress: progress })).toMatchObject({
      model: "gemini-3.8-flash",
      keyIndex: 4,
    });
    expect(calls()).toEqual([["test4", "gemini-3.8-flash"]]);
    expect(progress.mock.calls.slice(0, 3).map(([p]) => [p.phase, p.keyIndex, p.reason])).toEqual([
      ["skip", 1, "dailyQuota"],
      ["skip", 2, "dailyQuota"],
      ["skip", 3, "dailyQuota"],
    ]);
  });
  it("starts at 3.7 after every 3.8 project reports daily exhaustion", async () => {
    mocks.usageRead.mockResolvedValue(
      [1, 2, 3, 4].map((keyIndex) => ({
        keyIndex,
        model: "gemini-3.8-flash",
        success: 5,
        quota: 0,
        dailyQuota: 1,
      }))
    );
    mocks.call.mockResolvedValue(success);
    expect(await generateStoryEpisode(input)).toMatchObject({
      model: "gemini-3.7-flash",
      keyIndex: 1,
    });
    expect(calls()).toEqual([["test1", "gemini-3.7-flash"]]);
  });
  it("does not let a persisted cooldown skip protected 3.8", async () => {
    mocks.cooldownsRead.mockResolvedValue({ "gemini-3.8-flash": 60_000 });
    mocks.call.mockResolvedValue(success);
    expect(await generateStoryEpisode(input)).toMatchObject({
      model: "gemini-3.8-flash",
      keyIndex: 1,
    });
    expect(calls()).toEqual([["test1", "gemini-3.8-flash"]]);
  });
  it("still skips a lower observation model during its persisted cooldown", async () => {
    mocks.cooldownsRead.mockResolvedValue({ "gemini-3.6-flash": 60_000 });
    mocks.call.mockImplementation((_key, { model }) => {
      if (model === "gemini-3.8-flash" || model === "gemini-3.7-flash") {
        throw unavailable();
      }
      return success;
    });
    const progress = vi.fn();
    const pending = generateStoryEpisode({ ...input, onProgress: progress });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ model: "gemini-3.5-flash", keyIndex: 1 });
    expect(calls().some(([, model]) => model === "gemini-3.6-flash")).toBe(false);
    expect(progress).toHaveBeenCalledWith({
      phase: "skip",
      model: "gemini-3.6-flash",
      reason: "cooldown",
    });
  });
  it("observation overload tries a second key on protected 3.8", async () => {
    mocks.call.mockRejectedValueOnce(overloaded()).mockResolvedValue(success);
    const pending = generateStoryEpisode(input);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ model: "gemini-3.8-flash", keyIndex: 2 });
    expect(calls()).toEqual([
      ["test1", "gemini-3.8-flash"],
      ["test2", "gemini-3.8-flash"],
    ]);
    expect(mocks.usage).toHaveBeenCalledWith(
      "1969-12-31",
      1,
      "gemini-3.8-flash",
      "overloaded"
    );
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
