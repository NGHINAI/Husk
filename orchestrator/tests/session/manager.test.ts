import { describe, expect, it, vi } from "vitest";
import { SessionManager, SessionNotFoundError } from "../../src/session/manager.js";
import type { Session } from "../../src/session/session.js";

function fakeSession(): Session {
  const fake = {
    closed: false,
    goto: vi.fn(async () => {}),
    snapshot: vi.fn(async () => ({ v: 1, url: "x", count: 0, root: { i: "", r: "", n: "", s: [] } })),
    snapshotDiff: vi.fn(async () => null),
    close: vi.fn(async () => {
      fake.closed = true;
    }),
  };
  return fake as unknown as Session;
}

describe("SessionManager", () => {
  it("create() returns a fresh session_id and stores the session", async () => {
    const fake = fakeSession();
    const mgr = new SessionManager(async () => fake);
    const id = await mgr.create();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(mgr.get(id)).toBe(fake);
  });

  it("create() returns unique ids across calls", async () => {
    const mgr = new SessionManager(async () => fakeSession());
    const a = await mgr.create();
    const b = await mgr.create();
    expect(a).not.toBe(b);
  });

  it("get() throws SessionNotFoundError for unknown ids", () => {
    const mgr = new SessionManager(async () => fakeSession());
    expect(() => mgr.get("no-such-session")).toThrow(SessionNotFoundError);
  });

  it("close(id) tears down the session and forgets the id", async () => {
    const fake = fakeSession();
    const mgr = new SessionManager(async () => fake);
    const id = await mgr.create();
    await mgr.close(id);
    expect(fake.close).toHaveBeenCalled();
    expect(() => mgr.get(id)).toThrow(SessionNotFoundError);
  });

  it("close(id) on unknown id is a no-op (does not throw)", async () => {
    const mgr = new SessionManager(async () => fakeSession());
    await expect(mgr.close("ghost")).resolves.not.toThrow();
  });

  it("closeAll() tears down every live session", async () => {
    const fakeA = fakeSession();
    const fakeB = fakeSession();
    let next = 0;
    const mgr = new SessionManager(async () => (next++ === 0 ? fakeA : fakeB));
    await mgr.create();
    await mgr.create();
    await mgr.closeAll();
    expect(fakeA.close).toHaveBeenCalled();
    expect(fakeB.close).toHaveBeenCalled();
    expect(mgr.activeCount()).toBe(0);
  });

  it("activeCount() reflects the number of live sessions", async () => {
    const mgr = new SessionManager(async () => fakeSession());
    expect(mgr.activeCount()).toBe(0);
    await mgr.create();
    expect(mgr.activeCount()).toBe(1);
    await mgr.create();
    expect(mgr.activeCount()).toBe(2);
  });
});
