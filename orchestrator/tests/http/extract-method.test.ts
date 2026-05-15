import { describe, expect, it } from "vitest";
import { METHODS } from "../../src/http/methods.js";
import { SessionManager } from "../../src/session/manager.js";
import type { Session } from "../../src/session/session.js";

function makeCtx(extractImpl: (q: any) => Promise<string | null>) {
  const sm = new SessionManager(async () => ({
    close: async () => {},
    extract: extractImpl,
  }) as unknown as Session);
  return { sessions: sm, version: "0.0.0", vault: {} as any, credentials: {} as any };
}

describe("HTTP extract method", () => {
  it("forwards { session_id, css } to Session.extract and returns { text }", async () => {
    let receivedQuery: any;
    const ctx = makeCtx(async (q) => { receivedQuery = q; return "extracted text"; });
    const sid = await ctx.sessions.create();
    const r = await METHODS.extract({ session_id: sid, css: ".desc" }, ctx);
    expect(receivedQuery).toEqual({ css: ".desc" });
    expect(r).toEqual({ text: "extracted text" });
  });

  it("returns { text: null } when extract returns null", async () => {
    const ctx = makeCtx(async () => null);
    const sid = await ctx.sessions.create();
    const r = await METHODS.extract({ session_id: sid, css: ".missing" }, ctx);
    expect(r).toEqual({ text: null });
  });

  it("propagates session-not-found errors verbatim", async () => {
    const ctx = makeCtx(async () => "x");
    await expect(METHODS.extract({ session_id: "ghost", css: ".x" }, ctx))
      .rejects.toThrow(/Session not found/);
  });
});
