import { describe, it, expect, vi } from "vitest";
import { runVerifyWithRetry } from "../../src/cognition/verify-runner.js";
import type { VerifyCheck, VerifyContext } from "../../src/cognition/verify-runner.js";

const stubCtx = (url: string): VerifyContext => ({
  currentUrl: url,
  snapshot: { url, root: { i: "r", r: "main", n: "" } } as any,
});

describe("runVerifyWithRetry", () => {
  it("returns immediately when no retry policy", async () => {
    const check: VerifyCheck = { type: "url", pattern: "/done", description: "wait" };
    const factory = vi.fn(async () => stubCtx("https://x/done"));
    const ev = await runVerifyWithRetry(check, factory);
    expect(ev.passed).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ev.attempts).toBeUndefined();
  });

  it("polls until the check passes", async () => {
    let attempts = 0;
    const factory = vi.fn(async () => {
      attempts++;
      return stubCtx(attempts < 3 ? "https://x/loading" : "https://x/done");
    });
    const check: VerifyCheck = {
      type: "url", pattern: "/done", description: "wait",
      retry: { timeout_ms: 2000, interval_ms: 10 },
    };
    const ev = await runVerifyWithRetry(check, factory);
    expect(ev.passed).toBe(true);
    expect(ev.attempts).toBe(3);
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it("returns failure after timeout", async () => {
    const factory = vi.fn(async () => stubCtx("https://x/loading"));
    const check: VerifyCheck = {
      type: "url", pattern: "/done", description: "wait",
      retry: { timeout_ms: 50, interval_ms: 10 },
    };
    const ev = await runVerifyWithRetry(check, factory);
    expect(ev.passed).toBe(false);
    expect(ev.attempts).toBeGreaterThan(0);
  });

  it("respects max_attempts", async () => {
    const factory = vi.fn(async () => stubCtx("https://x/loading"));
    const check: VerifyCheck = {
      type: "url", pattern: "/done", description: "wait",
      retry: { timeout_ms: 60000, interval_ms: 1, max_attempts: 5 },
    };
    const ev = await runVerifyWithRetry(check, factory);
    expect(ev.passed).toBe(false);
    expect(ev.attempts).toBe(5);
    expect(factory).toHaveBeenCalledTimes(5);
  });

  it("uses retry options arg when check has none", async () => {
    let calls = 0;
    const factory = vi.fn(async () => {
      calls++;
      return stubCtx(calls < 2 ? "https://x/loading" : "https://x/done");
    });
    const check: VerifyCheck = { type: "url", pattern: "/done", description: "wait" }; // no retry on check
    const ev = await runVerifyWithRetry(check, factory, { timeout_ms: 1000, interval_ms: 10 });
    expect(ev.passed).toBe(true);
    expect(ev.attempts).toBe(2);
  });

  it("re-fetches context fresh each attempt (does not cache)", async () => {
    const factory = vi.fn(async () => stubCtx("https://x/loading"));
    const check: VerifyCheck = {
      type: "url", pattern: "/done", description: "wait",
      retry: { timeout_ms: 100, interval_ms: 10 },
    };
    await runVerifyWithRetry(check, factory);
    expect(factory).toHaveBeenCalled();
    expect(factory.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
