import { describe, it, expect } from "vitest";
import { HumanIOBus } from "../../src/hitl/bus.js";

describe("HumanIOBus questions", () => {
  it("askQuestion returns {token, watch_url placeholder absent, promise}; promise resolves on answer", async () => {
    const bus = new HumanIOBus();
    const { token, promise } = bus.askQuestion("sess1", { question: "Pick one", options: ["A", "B"] }, 10_000);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(8);

    // Question is pending
    const pending = bus.getQuestion(token);
    expect(pending).toMatchObject({
      session_id: "sess1",
      question: "Pick one",
      options: ["A", "B"],
    });

    // Resolve from the answer side
    bus.answerQuestion(token, { answer: "A", index: 0 });
    const r = await promise;
    expect(r).toEqual({ answer: "A", index: 0, ms_waited: expect.any(Number) });
    expect(r.ms_waited).toBeGreaterThanOrEqual(0);

    // After resolution, pending is gone
    expect(bus.getQuestion(token)).toBeNull();
  });

  it("question times out and returns {timed_out: true}", async () => {
    const bus = new HumanIOBus();
    const { promise } = bus.askQuestion("sess1", { question: "?" }, 50);
    const r = await promise;
    expect(r.timed_out).toBe(true);
    expect(r.ms_waited).toBeGreaterThanOrEqual(40);
  });

  it("answer to unknown token is a no-op (doesn't throw)", () => {
    const bus = new HumanIOBus();
    expect(() => bus.answerQuestion("ghost", { answer: "x" })).not.toThrow();
  });

  it("listPendingQuestions returns all pending across sessions", () => {
    const bus = new HumanIOBus();
    bus.askQuestion("sess1", { question: "Q1" }, 10_000);
    bus.askQuestion("sess2", { question: "Q2" }, 10_000);
    const pending = bus.listPendingQuestions();
    expect(pending).toHaveLength(2);
  });

  it("free-form question (no options) accepts string answer", async () => {
    const bus = new HumanIOBus();
    const { token, promise } = bus.askQuestion("sess1", { question: "Free form?" }, 10_000);
    bus.answerQuestion(token, { answer: "yes" });
    const r = await promise;
    expect(r.answer).toBe("yes");
    expect(r.index).toBeUndefined();
  });
});

describe("HumanIOBus handoffs", () => {
  it("startHandoff returns token + pending entry; resume resolves with cookies", async () => {
    const bus = new HumanIOBus();
    const { token, promise } = bus.startHandoff("sess1", {
      reason: "captcha",
      suggested_action: "Solve it",
      current_url: "https://x.com",
      need_cookies_back: true,
    }, 10_000);

    expect(bus.getHandoff(token)).toMatchObject({
      session_id: "sess1",
      reason: "captcha",
      need_cookies_back: true,
    });

    bus.resumeHandoff(token, {
      cookies: [{ name: "session", value: "abc123" }],
      note: "done",
    });
    const r = await promise;
    expect(r.resumed).toBe(true);
    expect(r.cookies_imported).toBe(1);
    expect(r.cookies).toEqual([{ name: "session", value: "abc123" }]);
    expect(r.human_note).toBe("done");
    expect(r.ms_paused).toBeGreaterThanOrEqual(0);
  });

  it("handoff timeout returns {resumed: false, reason: 'timeout'}", async () => {
    const bus = new HumanIOBus();
    const { promise } = bus.startHandoff("sess1", { reason: "x" }, 30);
    const r = await promise;
    expect(r.resumed).toBe(false);
    expect(r.reason).toBe("timeout");
  });

  it("resume to unknown token is a no-op", () => {
    const bus = new HumanIOBus();
    expect(() => bus.resumeHandoff("ghost", { note: "x" })).not.toThrow();
  });

  it("resume without cookies array still works (cookies_imported = 0)", async () => {
    const bus = new HumanIOBus();
    const { token, promise } = bus.startHandoff("sess1", { reason: "x" }, 10_000);
    bus.resumeHandoff(token, { note: "no cookies needed" });
    const r = await promise;
    expect(r.cookies_imported).toBe(0);
    expect(r.cookies).toEqual([]);
  });

  it("listPendingHandoffs returns all", () => {
    const bus = new HumanIOBus();
    bus.startHandoff("s1", { reason: "x" }, 10_000);
    bus.startHandoff("s2", { reason: "y" }, 10_000);
    expect(bus.listPendingHandoffs()).toHaveLength(2);
  });
});
