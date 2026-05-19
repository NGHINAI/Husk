import { describe, it, expect, vi } from "vitest";
import { HumanIOBus } from "../../src/hitl/bus.js";
import { WatchBus } from "../../src/watch/sse.js";
import { METHODS } from "../../src/http/methods.js";

describe("handoff RPC method", () => {
  const makeSession = () => ({
    pause: vi.fn(),
    resume: vi.fn(),
    isPaused: vi.fn().mockReturnValue(null),
    getCurrentUrl: vi.fn().mockReturnValue("https://example.com/captcha"),
    importCookies: vi.fn().mockResolvedValue(2),
  });

  it("pauses the session, emits pending_handoff, returns {pending, token, handoff_url, surface}", async () => {
    const session = makeSession();
    const humanIO = new HumanIOBus();
    const watchBus = new WatchBus();
    const events: any[] = [];
    watchBus.subscribe("sess1", (e) => events.push(e));

    const ctx = {
      humanIO, watchBus,
      host: "127.0.0.1", portRef: { value: 7777 },
      sessions: { get: () => session },
    };

    const r = await METHODS.handoff(
      {
        session_id: "sess1",
        reason: "captcha",
        suggested_action: "Solve hCaptcha then resume",
        need_cookies_back: true,
        timeout_ms: 10_000,
      },
      ctx as any,
    );

    expect(r.pending).toBe(true);
    expect(typeof r.token).toBe("string");
    expect(r.handoff_url).toBe(`http://127.0.0.1:7777/handoff/${r.token}`);
    expect(r.surface).toEqual({
      reason: "captcha",
      suggested_action: "Solve hCaptcha then resume",
      current_url: "https://example.com/captcha",
    });

    // Session was paused
    expect(session.pause).toHaveBeenCalledWith({
      token: r.token,
      handoff_url: r.handoff_url,
    });
    // pending_handoff event emitted
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "pending_handoff",
      token: r.token,
      reason: "captcha",
      need_cookies_back: true,
    });
  });

  it("when /handoff/:token/resume is POSTed with cookies, session.importCookies is called and resume() fires", async () => {
    const session = makeSession();
    const humanIO = new HumanIOBus();
    const watchBus = new WatchBus();

    const ctx = {
      humanIO, watchBus,
      host: "127.0.0.1", portRef: { value: 7777 },
      sessions: { get: () => session },
    };

    const handoffResult = await METHODS.handoff(
      {
        session_id: "sess1",
        reason: "x",
        timeout_ms: 10_000,
      },
      ctx as any,
    );

    // Simulate the /handoff/:token/resume POST by directly resolving the bus
    humanIO.resumeHandoff(handoffResult.token, {
      cookies: [{ name: "session", value: "abc123" }],
      note: "done",
    });

    // Allow the orchestrator's resume promise side effect (importCookies + session.resume) to fire
    await new Promise((r) => setTimeout(r, 30));

    expect(session.importCookies).toHaveBeenCalled();
    expect(session.resume).toHaveBeenCalled();
  });

  it("rejects empty reason", async () => {
    const humanIO = new HumanIOBus();
    const ctx = { humanIO, watchBus: new WatchBus(), host: "127.0.0.1", portRef: { value: 7777 }, sessions: { get: () => makeSession() } };
    await expect(
      METHODS.handoff({ session_id: "sess1", reason: "" }, ctx as any)
    ).rejects.toThrow(/reason/i);
  });

  it("handoff_url is null when not bound to 127.0.0.1", async () => {
    const humanIO = new HumanIOBus();
    const ctx = { humanIO, watchBus: new WatchBus(), host: "0.0.0.0", portRef: { value: 7777 }, sessions: { get: () => makeSession() } };
    const r = await METHODS.handoff(
      { session_id: "sess1", reason: "x" },
      ctx as any,
    );
    expect(r.handoff_url).toBeNull();
  });
});
