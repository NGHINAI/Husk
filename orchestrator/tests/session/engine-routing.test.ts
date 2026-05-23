import { describe, it, expect, vi, beforeEach } from "vitest";
import { METHODS } from "../../src/http/methods.js";
import { WatchBus } from "../../src/watch/sse.js";
import { HumanIOBus } from "../../src/hitl/bus.js";

vi.mock("../../src/engine/page-health.js", () => ({
  detectPageHealth: vi.fn(),
}));
vi.mock("../../src/engine/fallback.js", () => ({
  fallbackToChrome: vi.fn(),
}));

describe("engine routing on goto", () => {
  // Reset mocks between tests so call counts don't bleed across
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeBaseSnapshot = (engineOverride?: "lightpanda" | "chrome") => ({
    v: 1 as const,
    url: "/",
    count: 3,
    root: { i: "r", r: "RootWebArea", n: "", s: [], c: [] },
    console: [],
    engine: engineOverride ?? "lightpanda",
    sibling_sessions: [],
  });

  const makeSession = (overrides: Partial<{
    currentEngine: "lightpanda" | "chrome";
    requestedEngine: "lightpanda" | "chrome" | "auto";
    goto: (...args: unknown[]) => Promise<unknown>;
    snapshot: (...args: unknown[]) => Promise<unknown>;
  }> = {}) => ({
    currentEngine: "lightpanda" as const,
    requestedEngine: "auto" as const,
    goto: vi.fn().mockResolvedValue({ ok: true, snapshot: makeBaseSnapshot() }),
    snapshot: vi.fn().mockResolvedValue(makeBaseSnapshot("chrome")),
    ...overrides,
  });

  const makeCtx = (sessionObj: ReturnType<typeof makeSession>) => ({
    sessions: { get: () => sessionObj },
    chromePool: { acquire: vi.fn() },
    watchBus: new WatchBus(),
    humanIO: new HumanIOBus(),
    host: "127.0.0.1",
    portRef: { value: 7777 },
    version: "0.0.0-test",
    vault: {} as any,
    credentials: {} as any,
  });

  it("auto + health verdict 'should_fallback: false' → no fallback fires", async () => {
    const { detectPageHealth } = await import("../../src/engine/page-health.js");
    const { fallbackToChrome } = await import("../../src/engine/fallback.js");
    (detectPageHealth as any).mockReturnValue({ should_fallback: false, reasons: [] });

    const session = makeSession();
    const r = await METHODS.goto(
      { session_id: "s1", url: "https://wikipedia.org/" },
      makeCtx(session) as any
    );
    expect(r.ok).toBe(true);
    expect(fallbackToChrome).not.toHaveBeenCalled();
  });

  it("auto + health verdict 'should_fallback: true' → fallback fires; result has engine:chrome + fellback_from", async () => {
    const { detectPageHealth } = await import("../../src/engine/page-health.js");
    const { fallbackToChrome } = await import("../../src/engine/fallback.js");
    (detectPageHealth as any).mockReturnValue({ should_fallback: true, reasons: ["empty_ax_on_rich_site"] });
    (fallbackToChrome as any).mockResolvedValue({ ok: true, new_engine: "chrome", fellback_from: "lightpanda", cookies_transferred: 5, ms_elapsed: 1234 });

    const session = makeSession();
    const r = await METHODS.goto(
      { session_id: "s1", url: "https://linkedin.com/" },
      makeCtx(session) as any
    );
    expect(fallbackToChrome).toHaveBeenCalledOnce();
    expect((r as any).engine).toBe("chrome");
    expect((r as any).fellback_from).toBe("lightpanda");
    expect((r as any).fallback_reasons).toEqual(["empty_ax_on_rich_site"]);
  });

  it("explicit engine:'lightpanda' → no fallback even on rich site", async () => {
    const { detectPageHealth } = await import("../../src/engine/page-health.js");
    const { fallbackToChrome } = await import("../../src/engine/fallback.js");
    (detectPageHealth as any).mockReturnValue({ should_fallback: true, reasons: ["empty_ax"] });

    const session = makeSession({ requestedEngine: "lightpanda" });
    await METHODS.goto(
      { session_id: "s1", url: "https://linkedin.com/" },
      makeCtx(session) as any
    );
    expect(fallbackToChrome).not.toHaveBeenCalled();
  });

  it("explicit engine:'chrome' on session, lightpanda is never tried — no fallback", async () => {
    const { fallbackToChrome } = await import("../../src/engine/fallback.js");

    const session = makeSession({ currentEngine: "chrome", requestedEngine: "chrome" });
    await METHODS.goto(
      { session_id: "s1", url: "https://linkedin.com/" },
      makeCtx(session) as any
    );
    expect(fallbackToChrome).not.toHaveBeenCalled();
  });

  it("auto + fallback fails → response has fallback_failed field", async () => {
    const { detectPageHealth } = await import("../../src/engine/page-health.js");
    const { fallbackToChrome } = await import("../../src/engine/fallback.js");
    (detectPageHealth as any).mockReturnValue({ should_fallback: true, reasons: ["empty_ax"] });
    (fallbackToChrome as any).mockResolvedValue({ ok: false, reason: "chrome_not_found", cookies_transferred: 0, ms_elapsed: 50 });

    const session = makeSession();
    const r = await METHODS.goto(
      { session_id: "s1", url: "https://linkedin.com/" },
      makeCtx(session) as any
    );
    expect((r as any).fallback_failed).toEqual({ reason: "chrome_not_found", attempted_reasons: ["empty_ax"] });
  });

  it("no chromePool in ctx → no fallback attempt even on rich site (auto session)", async () => {
    const { detectPageHealth } = await import("../../src/engine/page-health.js");
    const { fallbackToChrome } = await import("../../src/engine/fallback.js");
    (detectPageHealth as any).mockReturnValue({ should_fallback: true, reasons: ["empty_ax_on_rich_site"] });

    const session = makeSession();
    const ctx = {
      sessions: { get: () => session },
      // No chromePool
      watchBus: new WatchBus(),
      humanIO: new HumanIOBus(),
      host: "127.0.0.1",
      portRef: { value: 7777 },
      version: "0.0.0-test",
      vault: {} as any,
      credentials: {} as any,
    };
    const r = await METHODS.goto(
      { session_id: "s1", url: "https://linkedin.com/" },
      ctx as any
    );
    expect(r.ok).toBe(true);
    expect(fallbackToChrome).not.toHaveBeenCalled();
  });
});
