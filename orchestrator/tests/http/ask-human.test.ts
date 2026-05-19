import { describe, it, expect } from "vitest";
import { HumanIOBus } from "../../src/hitl/bus.js";
import { WatchBus } from "../../src/watch/sse.js";
import { METHODS } from "../../src/http/methods.js";

describe("ask_human RPC method", () => {
  it("returns {pending, token, watch_url, surface} immediately and emits to WatchBus", async () => {
    const humanIO = new HumanIOBus();
    const watchBus = new WatchBus();
    const watchEvents: unknown[] = [];
    watchBus.subscribe("sess1", (e) => watchEvents.push(e));

    const ctx = {
      humanIO,
      watchBus,
      host: "127.0.0.1",
      portRef: { value: 7777 },
      sessions: { get: () => ({}) },
      version: "0.0.0-test",
      vault: {} as any,
      credentials: {} as any,
    };

    // Call the method
    const result = await METHODS.ask_human(
      {
        session_id: "sess1",
        question: "Pick one:",
        options: ["A", "B"],
        timeout_ms: 10_000,
      },
      ctx as any
    );

    expect(result.pending).toBe(true);
    expect(typeof result.token).toBe("string");
    expect(result.watch_url).toBe("http://127.0.0.1:7777/watch?s=sess1");
    expect(result.surface).toEqual({ question: "Pick one:", options: ["A", "B"] });

    // WatchBus got the event
    expect(watchEvents).toHaveLength(1);
    expect(watchEvents[0]).toMatchObject({
      kind: "pending_question",
      token: result.token,
      question: "Pick one:",
      options: ["A", "B"],
    });

    // Question is pending in the bus
    expect(humanIO.getQuestion(result.token)).toBeTruthy();
  });

  it("free-form question (no options) returns surface without options", async () => {
    const humanIO = new HumanIOBus();
    const watchBus = new WatchBus();
    const ctx = {
      humanIO,
      watchBus,
      host: "127.0.0.1",
      portRef: { value: 7777 },
      sessions: { get: () => ({}) },
      version: "0.0.0-test",
      vault: {} as any,
      credentials: {} as any,
    };
    const result = await METHODS.ask_human(
      { session_id: "sess1", question: "What's the price?" },
      ctx as any
    );
    expect(result.surface).toEqual({ question: "What's the price?" });
    expect((result.surface as any).options).toBeUndefined();
  });

  it("rejects empty question", async () => {
    const humanIO = new HumanIOBus();
    const ctx = {
      humanIO,
      watchBus: new WatchBus(),
      host: "127.0.0.1",
      portRef: { value: 7777 },
      sessions: { get: () => ({}) },
      version: "0.0.0-test",
      vault: {} as any,
      credentials: {} as any,
    };
    await expect(
      METHODS.ask_human({ session_id: "sess1", question: "" }, ctx as any)
    ).rejects.toThrow(/question/i);
  });

  it("returns watch_url: null when not bound to 127.0.0.1", async () => {
    const humanIO = new HumanIOBus();
    const ctx = {
      humanIO,
      watchBus: new WatchBus(),
      host: "0.0.0.0",
      portRef: { value: 7777 },
      sessions: { get: () => ({}) },
      version: "0.0.0-test",
      vault: {} as any,
      credentials: {} as any,
    };
    const result = await METHODS.ask_human(
      { session_id: "sess1", question: "Q?" },
      ctx as any
    );
    expect(result.watch_url).toBeNull();
  });
});
