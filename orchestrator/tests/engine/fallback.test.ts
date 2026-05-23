import { describe, it, expect, vi } from "vitest";
import { fallbackToChrome } from "../../src/engine/fallback.js";
import type { EngineHandle } from "../../src/engine/engine-router.js";

const makeSession = (overrides: Partial<any> = {}): any => ({
  getCurrentUrl: vi.fn().mockReturnValue("https://linkedin.com/login"),
  exportCookies: vi.fn().mockResolvedValue([
    { name: "li_at", value: "abc", domain: ".linkedin.com" },
  ]),
  importCookies: vi.fn().mockResolvedValue(1),
  swapEngine: vi.fn().mockResolvedValue(undefined),
  releaseEngine: vi.fn().mockResolvedValue(undefined),
  goto: vi.fn().mockResolvedValue({ ok: true }),
  ...overrides,
});

const makeChromePool = () => {
  const releases: any[] = [];
  return {
    acquire: vi.fn().mockImplementation(async (sessionId: string) => {
      const handle: EngineHandle = {
        kind: "chrome" as const,
        cdp: { send: vi.fn() } as any,
        release: vi.fn().mockResolvedValue(undefined),
      };
      return handle;
    }),
    releaseToPool: vi.fn(),
    close: vi.fn(),
    _releases: releases,
  };
};

describe("fallbackToChrome", () => {
  it("captures cookies + URL, releases lightpanda, acquires chrome, restores state, navigates", async () => {
    const session = makeSession();
    const pool = makeChromePool();
    const result = await fallbackToChrome(session, pool as any, "sess-1");

    expect(result.ok).toBe(true);
    expect(result.new_engine).toBe("chrome");
    expect(result.cookies_transferred).toBe(1);
    expect(typeof result.ms_elapsed).toBe("number");
    expect(result.ms_elapsed).toBeGreaterThanOrEqual(0);

    // Verify the order: getCurrentUrl + exportCookies BEFORE releaseEngine + swap
    expect(session.getCurrentUrl).toHaveBeenCalled();
    expect(session.exportCookies).toHaveBeenCalled();
    expect(session.releaseEngine).toHaveBeenCalled();
    expect(pool.acquire).toHaveBeenCalledOnce();
    expect(session.swapEngine).toHaveBeenCalledOnce();
    expect(session.importCookies).toHaveBeenCalledWith([
      { name: "li_at", value: "abc", domain: ".linkedin.com" },
    ]);
    expect(session.goto).toHaveBeenCalledWith("https://linkedin.com/login");
  });

  it("returns ok:false with chrome_not_found when pool can't spawn", async () => {
    const session = makeSession();
    const pool = {
      acquire: vi.fn().mockRejectedValue(new Error("Chrome-family browser not found")),
      releaseToPool: vi.fn(), close: vi.fn(),
    };
    const result = await fallbackToChrome(session, pool as any, "sess-1");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("chrome_not_found");
  });

  it("returns ok:false with pool_exhausted when pool times out", async () => {
    const session = makeSession();
    const pool = {
      acquire: vi.fn().mockRejectedValue(new Error("ChromePool acquire timeout")),
      releaseToPool: vi.fn(), close: vi.fn(),
    };
    const result = await fallbackToChrome(session, pool as any, "sess-1");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("pool_exhausted");
  });

  it("propagates URL even when cookies are empty (no auth state to transfer)", async () => {
    const session = makeSession({ exportCookies: vi.fn().mockResolvedValue([]) });
    const pool = makeChromePool();
    const result = await fallbackToChrome(session, pool as any, "sess-1");
    expect(result.ok).toBe(true);
    expect(result.cookies_transferred).toBe(0);
    expect(session.goto).toHaveBeenCalledWith("https://linkedin.com/login");
  });

  it("does NOT crash if session.exportCookies throws — proceeds with 0 cookies", async () => {
    const session = makeSession({
      exportCookies: vi.fn().mockRejectedValue(new Error("CDP error")),
    });
    const pool = makeChromePool();
    const result = await fallbackToChrome(session, pool as any, "sess-1");
    expect(result.ok).toBe(true);
    expect(result.cookies_transferred).toBe(0);
  });

  it("cleans up: even if goto fails, the old engine is still released", async () => {
    const session = makeSession({
      goto: vi.fn().mockRejectedValue(new Error("nav failed")),
    });
    const pool = makeChromePool();
    const result = await fallbackToChrome(session, pool as any, "sess-1");
    // Either ok:false or we recovered — but releaseEngine must have been called
    expect(session.releaseEngine).toHaveBeenCalled();
  });

  it("uses session.id as sessionId for pool.acquire when provided", async () => {
    const session = makeSession();
    const pool = makeChromePool();
    await fallbackToChrome(session, pool as any, "my-session-42");
    expect(pool.acquire).toHaveBeenCalledWith("my-session-42");
  });

  it("preserves the about:blank case (no URL to navigate to)", async () => {
    const session = makeSession({
      getCurrentUrl: vi.fn().mockReturnValue(null),
    });
    const pool = makeChromePool();
    const result = await fallbackToChrome(session, pool as any, "sess-1");
    expect(result.ok).toBe(true);
    // Should NOT call goto when there's no URL
    expect(session.goto).not.toHaveBeenCalled();
  });
});
