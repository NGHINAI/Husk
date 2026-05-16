import { describe, it, expect, afterEach } from "vitest";
import { createHuskServer, type HuskServer } from "../../src/http/server.js";
import { WatchBus } from "../../src/watch/sse.js";
import { SessionManager } from "../../src/session/manager.js";
import type { Session } from "../../src/session/session.js";

function fakeSession(): Session {
  return {
    goto: async () => {},
    snapshot: async () => ({ v: 1, url: "x", count: 0, root: { i: "", r: "", n: "", s: [] } }),
    snapshotDiff: async () => null,
    close: async () => {},
  } as unknown as Session;
}

const fakeVault = { listProfiles: () => [], list: () => [], clear: () => {}, remove: () => {} } as any;
const fakeCreds = { listProfiles: () => [], list: () => [], get: () => null, set: () => {}, remove: () => {}, close: () => {} } as any;

async function startTestServer(opts: { host: string }): Promise<HuskServer> {
  const watchBus = new WatchBus();
  const sessions = new SessionManager(async () => fakeSession(), watchBus);
  return createHuskServer({
    host: opts.host,
    port: 0,
    sessions,
    version: "test",
    logLevel: "silent",
    vault: fakeVault,
    credentials: fakeCreds,
    watchBus,
  });
}

describe("create_session watch_url", () => {
  let server: HuskServer | undefined;
  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it("returns a /watch URL when bound to 127.0.0.1", async () => {
    server = await startTestServer({ host: "127.0.0.1" });
    const r = await fetch(`http://127.0.0.1:${server.port}/v1/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "create_session", params: {} }),
    });
    const body = await r.json() as { result: { session_id: string; watch_url: string | null } };
    expect(body.result.session_id).toMatch(/^[a-f0-9-]+$/i);
    expect(body.result.watch_url).toBe(
      `http://127.0.0.1:${server.port}/watch?s=${encodeURIComponent(body.result.session_id)}`
    );
  });

  it("returns watch_url=null when bound to 0.0.0.0", async () => {
    server = await startTestServer({ host: "0.0.0.0" });
    const r = await fetch(`http://127.0.0.1:${server.port}/v1/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "create_session", params: {} }),
    });
    const body = await r.json() as { result: { session_id: string; watch_url: string | null } };
    expect(body.result.watch_url).toBeNull();
  });
});
