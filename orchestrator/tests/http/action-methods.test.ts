import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { METHODS } from "../../src/http/methods.js";
import { SessionManager } from "../../src/session/manager.js";
import type { Session } from "../../src/session/session.js";

function makeCtx(session: Partial<Session>) {
  const sm = new SessionManager(async () => session as Session);
  return { ctx: { sessions: sm, version: "0.0.0", vault: { listProfiles: () => [], list: () => [], clear: () => {}, remove: () => {} } as any, credentials: { listProfiles: () => [], list: () => [], get: () => null, set: () => {}, remove: () => {}, close: () => {} } as any }, sm };
}

describe("HTTP action methods", () => {
  let sessionId: string;
  let click: ReturnType<typeof vi.fn>;
  let type_: ReturnType<typeof vi.fn>;
  let scroll: ReturnType<typeof vi.fn>;
  let press: ReturnType<typeof vi.fn>;
  let ctx: ReturnType<typeof makeCtx>["ctx"];
  let sm: ReturnType<typeof makeCtx>["sm"];

  beforeEach(async () => {
    click = vi.fn(async () => ({ ok: true, warnings: [] }));
    type_ = vi.fn(async () => ({ ok: true, warnings: [] }));
    scroll = vi.fn(async () => ({ ok: true, warnings: [] }));
    press = vi.fn(async () => ({ ok: true, warnings: [] }));
    const made = makeCtx({
      click, type: type_, scroll, press_key: press,
      close: async () => {},
    });
    ctx = made.ctx;
    sm = made.sm;
    sessionId = await ctx.sessions.create();
  });

  afterEach(async () => {
    await sm.closeAll();
  });

  it("click forwards stable_id as Target object to Session.click", async () => {
    const res = await METHODS.click({ session_id: sessionId, stable_id: "button:s" }, ctx);
    expect(click).toHaveBeenCalledWith({ stable_id: "button:s", intent: undefined, include_snapshot: undefined });
    expect(res).toEqual({ ok: true, warnings: [] });
  });

  it("click forwards intent as Target object to Session.click", async () => {
    await METHODS.click({ session_id: sessionId, intent: "sign in button" }, ctx);
    expect(click).toHaveBeenCalledWith({ stable_id: undefined, intent: "sign in button", include_snapshot: undefined });
  });

  it("type forwards stable_id + text as Target object", async () => {
    await METHODS.type({ session_id: sessionId, stable_id: "textbox:e", text: "hello" }, ctx);
    expect(type_).toHaveBeenCalledWith({ stable_id: "textbox:e", intent: undefined, include_snapshot: undefined }, "hello");
  });

  it("scroll accepts null stable_id (window scroll) as Target object", async () => {
    await METHODS.scroll({ session_id: sessionId, stable_id: null, direction: "down", amount: 300 }, ctx);
    expect(scroll).toHaveBeenCalledWith(
      { stable_id: null, intent: undefined, include_snapshot: undefined },
      "down",
      300,
      { until: undefined, max_scrolls: undefined, scroll_amount_px: undefined, include_snapshot: undefined },
    );
  });

  it("press_key forwards the key string", async () => {
    await METHODS.press_key({ session_id: sessionId, key: "Enter" }, ctx);
    expect(press).toHaveBeenCalledWith("Enter", { include_snapshot: undefined });
  });

  it("returns the rejection envelope verbatim when watchdog rejects", async () => {
    click.mockResolvedValueOnce({
      ok: false, reason: "element_not_found", verb: "click",
      stable_id_attempted: "button:ghost", candidates: [],
      snapshot_at_attempt: { v: 1, url: "x", count: 0, root: { i: "x", r: "x", n: "", s: [] } },
    });
    const res = await METHODS.click({ session_id: sessionId, stable_id: "button:ghost" }, ctx);
    expect((res as { ok: boolean }).ok).toBe(false);
    expect((res as { reason: string }).reason).toBe("element_not_found");
  });
});
