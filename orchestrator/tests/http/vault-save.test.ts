import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { METHODS } from "../../src/http/methods.js";
import { SessionManager } from "../../src/session/manager.js";
import type { Session } from "../../src/session/session.js";

function makeCtx(session: Partial<Session>) {
  const sm = new SessionManager(async () => session as Session);
  const vault = {
    listProfiles: vi.fn(() => []),
    list: vi.fn((profile: string) => []),
    put: vi.fn(),
    clear: vi.fn(),
    remove: vi.fn(),
  };
  return {
    ctx: {
      sessions: sm,
      version: "0.0.0",
      vault: vault as any,
      credentials: { listProfiles: () => [], list: () => [], get: () => null, set: () => {}, remove: () => {}, close: () => {} } as any,
    },
    sm,
    vault,
  };
}

describe("vault_save method", () => {
  let sessionId: string;
  let captureToVault: ReturnType<typeof vi.fn>;
  let ctx: ReturnType<typeof makeCtx>["ctx"];
  let sm: ReturnType<typeof makeCtx>["sm"];
  let vault: ReturnType<typeof makeCtx>["vault"];

  beforeEach(async () => {
    captureToVault = vi.fn(async () => {});
  });

  afterEach(async () => {
    await sm.closeAll();
  });

  it("with profile set and cookies in session, returns {saved: true, cookie_count: N}", async () => {
    const made = makeCtx({
      captureToVault,
      getProfile: () => "test_profile",
      close: async () => {},
    });
    ctx = made.ctx;
    sm = made.sm;
    vault = made.vault;

    sessionId = await ctx.sessions.create({ profile: "test_profile" });
    vault.list.mockReturnValueOnce([
      { name: "cookie1", domain: "example.com", path: "/" },
      { name: "cookie2", domain: "example.com", path: "/" },
    ]);

    const result = await METHODS.vault_save({ session_id: sessionId }, ctx);

    expect(captureToVault).toHaveBeenCalled();
    expect(result).toEqual({
      saved: true,
      profile: "test_profile",
      cookie_count: 2,
    });
  });

  it("with no profile set, returns {saved: false, reason}", async () => {
    const made = makeCtx({
      captureToVault,
      getProfile: () => null,
      close: async () => {},
    });
    ctx = made.ctx;
    sm = made.sm;
    vault = made.vault;

    sessionId = await ctx.sessions.create();

    const result = await METHODS.vault_save({ session_id: sessionId }, ctx);

    expect(captureToVault).not.toHaveBeenCalled();
    expect(result).toEqual({
      saved: false,
      reason: "session has no profile attached",
    });
  });

  it("with bogus session_id, throws with 'Session not found'", async () => {
    const made = makeCtx({
      captureToVault,
      getProfile: () => "test_profile",
      close: async () => {},
    });
    ctx = made.ctx;
    sm = made.sm;

    const promise = METHODS.vault_save({ session_id: "nonexistent-id" }, ctx);

    await expect(promise).rejects.toThrow("Session not found: nonexistent-id");
  });
});
