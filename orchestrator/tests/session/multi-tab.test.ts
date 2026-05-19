import { describe, it, expect, vi } from "vitest";
import { Session } from "../../src/session/session.js";
import { SessionManager } from "../../src/session/manager.js";

describe("SessionManager multi-tab", () => {
  it("creates a child session sharing the parent's tab group", async () => {
    // Factory returns a stub session (no real engine)
    let counter = 0;
    const factory = async () => ({
      id: `s${++counter}`,
      close: async () => {},
      snapshot: async () => ({ root: { i: "r", r: "root", n: "" }, url: "/", mode: "full", sibling_sessions: [] }),
    } as any);

    const sm = new SessionManager(factory);
    const s1 = await sm.create({});
    const s2 = await sm.create({ parent_session_id: s1 });
    const s3 = await sm.create({ parent_session_id: s2 });  // grandchild

    // All three should be in same group
    const snap1 = await sm.get(s1).snapshot();
    const snap2 = await sm.get(s2).snapshot();
    const snap3 = await sm.get(s3).snapshot();

    expect(new Set(snap1.sibling_sessions)).toEqual(new Set([s2, s3]));
    expect(new Set(snap2.sibling_sessions)).toEqual(new Set([s1, s3]));
    expect(new Set(snap3.sibling_sessions)).toEqual(new Set([s1, s2]));
  });

  it("closing the root cascade-closes all siblings", async () => {
    const closes: string[] = [];
    const factory = async (opts?: { watchSessionId?: string }) => {
      const id = opts?.watchSessionId ?? "unknown";
      return {
        id,
        close: async () => { closes.push(id); },
        snapshot: async () => ({ root: { i: "r", r: "root", n: "" }, url: "/", mode: "full", sibling_sessions: [] }),
      } as any;
    };
    const sm = new SessionManager(factory);
    const s1 = await sm.create({});
    const s2 = await sm.create({ parent_session_id: s1 });
    const s3 = await sm.create({ parent_session_id: s1 });
    await sm.close(s1);
    expect(closes.sort()).toEqual([s1, s2, s3].sort());
  });

  it("closing a child does NOT close the root or other siblings", async () => {
    const closes: string[] = [];
    const factory = async (opts?: { watchSessionId?: string }) => {
      const id = opts?.watchSessionId ?? "unknown";
      return { id, close: async () => { closes.push(id); }, snapshot: async () => ({}) } as any;
    };
    const sm = new SessionManager(factory);
    const s1 = await sm.create({});
    const s2 = await sm.create({ parent_session_id: s1 });
    const s3 = await sm.create({ parent_session_id: s1 });
    await sm.close(s2);
    expect(closes).toEqual([s2]);
    // s1 and s3 still alive
    expect(sm.get(s1)).toBeDefined();
    expect(sm.get(s3)).toBeDefined();
  });

  it("unknown parent_session_id throws", async () => {
    const factory = async () => ({ id: "x", close: async () => {}, snapshot: async () => ({}) } as any);
    const sm = new SessionManager(factory);
    await expect(sm.create({ parent_session_id: "ghost" })).rejects.toThrow(/unknown parent/);
  });

  it("fromInjected snapshot has empty sibling_sessions (back-compat)", async () => {
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Accessibility.getFullAXTree") {
          return {
            nodes: [{
              nodeId: "1", role: { type: "role", value: "RootWebArea" },
              name: { type: "computedString", value: "" }, properties: [], childIds: [],
            }],
          };
        }
        return null;
      }),
      close: async () => {},
    };
    const session = Session.fromInjected({
      engine: { close: async () => {} },
      cdp,
      sessionId: "s1",
    });
    const snap = await session.snapshot();
    expect(snap.sibling_sessions).toEqual([]);
  });
});
