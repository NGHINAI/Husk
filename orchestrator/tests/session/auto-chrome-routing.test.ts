/**
 * auto-chrome-routing.test.ts
 *
 * T4 (M24): pre-flight Chrome routing for KNOWN_RICH_SITES.
 *
 * Verifies that methods.goto() calls fallbackToChrome BEFORE session.goto()
 * when the current engine is lightpanda and the destination URL belongs to
 * a KNOWN_RICH_SITES host. Uses stub sessions and mocked fallbackToChrome to
 * avoid spinning real engines.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { METHODS } from "../../src/http/methods.js";
import { WatchBus } from "../../src/watch/sse.js";
import { HumanIOBus } from "../../src/hitl/bus.js";

// Mock the fallback module so we can spy on fallbackToChrome without
// needing a real Chrome pool.
vi.mock("../../src/engine/fallback.js", () => ({
  fallbackToChrome: vi.fn(),
}));

// Partially mock page-health: keep the real KNOWN_RICH_SITES export so that
// isRichSite() in methods.ts works correctly, but stub detectPageHealth to
// suppress the M17 post-goto health check (we want to isolate the pre-flight).
vi.mock("../../src/engine/page-health.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/engine/page-health.js")>();
  return {
    ...real,
    detectPageHealth: vi.fn().mockReturnValue({ should_fallback: false, reasons: [] }),
  };
});

describe("pre-flight chrome routing for KNOWN_RICH_SITES", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const makeSnapshot = (engine: "lightpanda" | "chrome" = "lightpanda") => ({
    v: 1 as const,
    url: "/",
    count: 3,
    root: { i: "r", r: "RootWebArea", n: "", s: [], c: [] },
    console: [],
    engine,
    sibling_sessions: [],
  });

  /** Build a minimal stub session with mutable `currentEngine`. */
  const makeSession = (overrides: Partial<{
    currentEngine: "lightpanda" | "chrome";
    requestedEngine: "lightpanda" | "chrome" | "auto";
  }> = {}) => {
    const sess = {
      currentEngine: "lightpanda" as "lightpanda" | "chrome",
      requestedEngine: "auto" as "lightpanda" | "chrome" | "auto",
      goto: vi.fn().mockResolvedValue({ ok: true, snapshot: makeSnapshot() }),
      snapshot: vi.fn().mockResolvedValue(makeSnapshot()),
      ...overrides,
    };
    return sess;
  };

  /** Build a minimal MethodContext with a chromePool stub. */
  const makeCtx = (sessionObj: ReturnType<typeof makeSession>, opts: { noChromePool?: boolean } = {}) => ({
    sessions: { get: () => sessionObj },
    chromePool: opts.noChromePool ? undefined : { acquire: vi.fn(), releaseToPool: vi.fn() },
    watchBus: new WatchBus(),
    humanIO: new HumanIOBus(),
    host: "127.0.0.1",
    portRef: { value: 7777 },
    version: "0.0.0-test",
    vault: {} as any,
    credentials: {} as any,
  });

  // ---------------------------------------------------------------------------
  // Test 1: linkedin.com → pre-flight swap fires
  // ---------------------------------------------------------------------------

  it("Test 1: goto linkedin.com on lightpanda → fallbackToChrome called before session.goto", async () => {
    const { fallbackToChrome } = await import("../../src/engine/fallback.js");
    (fallbackToChrome as any).mockResolvedValue({
      ok: true,
      new_engine: "chrome",
      fellback_from: "lightpanda",
      cookies_transferred: 0,
      ms_elapsed: 10,
    });

    const session = makeSession({ currentEngine: "lightpanda", requestedEngine: "auto" });
    const ctx = makeCtx(session);

    const callOrder: string[] = [];
    (fallbackToChrome as any).mockImplementation(async () => {
      callOrder.push("fallbackToChrome");
      // Simulate the swap updating currentEngine
      session.currentEngine = "chrome";
      return { ok: true, new_engine: "chrome", fellback_from: "lightpanda", cookies_transferred: 0, ms_elapsed: 10 };
    });
    session.goto.mockImplementation(async () => {
      callOrder.push("session.goto");
      return { ok: true, snapshot: makeSnapshot("chrome") };
    });

    await METHODS.goto(
      { session_id: "s1", url: "https://linkedin.com/feed" },
      ctx as any
    );

    // Pre-flight must fire BEFORE session.goto()
    expect(fallbackToChrome).toHaveBeenCalledOnce();
    expect(callOrder.indexOf("fallbackToChrome")).toBeLessThan(callOrder.indexOf("session.goto"));
  });

  // ---------------------------------------------------------------------------
  // Test 2: www.linkedin.com → www. prefix stripped, still triggers swap
  // ---------------------------------------------------------------------------

  it("Test 2: goto www.linkedin.com → host normalisation works, fallbackToChrome called", async () => {
    const { fallbackToChrome } = await import("../../src/engine/fallback.js");
    (fallbackToChrome as any).mockResolvedValue({
      ok: true,
      new_engine: "chrome",
      fellback_from: "lightpanda",
      cookies_transferred: 0,
      ms_elapsed: 10,
    });

    const session = makeSession({ currentEngine: "lightpanda", requestedEngine: "auto" });
    const ctx = makeCtx(session);

    await METHODS.goto(
      { session_id: "s1", url: "https://www.linkedin.com/feed" },
      ctx as any
    );

    expect(fallbackToChrome).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // Test 3: example.com → not in KNOWN_RICH_SITES → no swap
  // ---------------------------------------------------------------------------

  it("Test 3: goto example.com on lightpanda → no swap, fallbackToChrome not called", async () => {
    const { fallbackToChrome } = await import("../../src/engine/fallback.js");

    const session = makeSession({ currentEngine: "lightpanda", requestedEngine: "auto" });
    const ctx = makeCtx(session);

    await METHODS.goto(
      { session_id: "s1", url: "https://example.com/" },
      ctx as any
    );

    expect(fallbackToChrome).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Test 4: session already on chrome → no swap attempt
  // ---------------------------------------------------------------------------

  it("Test 4: goto linkedin.com on session already using chrome → no swap", async () => {
    const { fallbackToChrome } = await import("../../src/engine/fallback.js");

    const session = makeSession({ currentEngine: "chrome", requestedEngine: "chrome" });
    const ctx = makeCtx(session);

    await METHODS.goto(
      { session_id: "s1", url: "https://linkedin.com/" },
      ctx as any
    );

    expect(fallbackToChrome).not.toHaveBeenCalled();
  });
});
