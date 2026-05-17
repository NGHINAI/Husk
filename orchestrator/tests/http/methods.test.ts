import { describe, expect, it, vi } from "vitest";
import { METHODS, type MethodContext } from "../../src/http/methods.js";
import { SessionManager, SessionNotFoundError } from "../../src/session/manager.js";
import { InvalidUrlError } from "../../src/http/errors.js";
import type { Session } from "../../src/session/session.js";

function fakeSession(overrides: Partial<Session> = {}): Session {
  const base = {
    goto: vi.fn(async () => ({ ok: true as const })),
    snapshot: vi.fn(async () => ({
      v: 1,
      url: "https://example.com",
      count: 2,
      root: { i: "x", r: "RootWebArea", n: "", s: [] },
    })),
    snapshotDiff: vi.fn(async () => null),
    close: vi.fn(async () => {}),
  };
  return { ...base, ...overrides } as unknown as Session;
}

function buildCtx(): { ctx: MethodContext; mgr: SessionManager; created: Session[] } {
  const created: Session[] = [];
  const mgr = new SessionManager(async () => {
    const s = fakeSession();
    created.push(s);
    return s;
  });
  return {
    ctx: { sessions: mgr, version: "0.0.0-test", vault: { listProfiles: () => [], list: () => [], clear: () => {}, remove: () => {} } as any, credentials: { listProfiles: () => [], list: () => [], get: () => null, set: () => {}, remove: () => {}, close: () => {} } as any },
    mgr,
    created,
  };
}

describe("health", () => {
  it("returns ok + version + activeCount", async () => {
    const { ctx, mgr } = buildCtx();
    await mgr.create();
    const result = await METHODS.health({}, ctx);
    expect(result).toEqual({ ok: true, version: "0.0.0-test", activeSessions: 1 });
  });
});

describe("create_session", () => {
  it("returns a session_id string", async () => {
    const { ctx } = buildCtx();
    const result = (await METHODS.create_session({}, ctx)) as { session_id: string };
    expect(typeof result.session_id).toBe("string");
    expect(result.session_id.length).toBeGreaterThan(0);
  });
});

describe("goto", () => {
  it("calls Session.goto with the supplied url", async () => {
    const { ctx, mgr, created } = buildCtx();
    const id = await mgr.create();
    await METHODS.goto({ session_id: id, url: "https://example.com/" }, ctx);
    expect(created[0].goto).toHaveBeenCalledWith("https://example.com/", { include_snapshot: undefined });
  });

  it("throws SessionNotFoundError for unknown session", async () => {
    const { ctx } = buildCtx();
    await expect(
      METHODS.goto({ session_id: "nope", url: "https://example.com" }, ctx)
    ).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it("throws InvalidUrlError when url is not a string", async () => {
    const { ctx, mgr } = buildCtx();
    const id = await mgr.create();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      METHODS.goto({ session_id: id, url: 123 } as any, ctx)
    ).rejects.toBeInstanceOf(InvalidUrlError);
  });

  it("throws InvalidUrlError when url fails to parse", async () => {
    const { ctx, mgr } = buildCtx();
    const id = await mgr.create();
    await expect(METHODS.goto({ session_id: id, url: "not a url" }, ctx)).rejects.toBeInstanceOf(
      InvalidUrlError
    );
  });
});

describe("snapshot", () => {
  it("returns the Session.snapshot() result", async () => {
    const { ctx, mgr } = buildCtx();
    const id = await mgr.create();
    const result = await METHODS.snapshot({ session_id: id }, ctx);
    expect(result).toMatchObject({ v: 1, url: "https://example.com", count: 2 });
  });
});

describe("snapshot_diff", () => {
  it("returns null when there's no prior snapshot", async () => {
    const { ctx, mgr } = buildCtx();
    const id = await mgr.create();
    const result = await METHODS.snapshot_diff({ session_id: id }, ctx);
    expect(result).toBeNull();
  });
});

describe("close_session", () => {
  it("closes the session and returns ok", async () => {
    const { ctx, mgr, created } = buildCtx();
    const id = await mgr.create();
    const result = await METHODS.close_session({ session_id: id }, ctx);
    expect(result).toEqual({ ok: true });
    expect(created[0].close).toHaveBeenCalled();
  });

  it("is idempotent on unknown session_id (no throw)", async () => {
    const { ctx } = buildCtx();
    const result = await METHODS.close_session({ session_id: "ghost" }, ctx);
    expect(result).toEqual({ ok: true });
  });
});
