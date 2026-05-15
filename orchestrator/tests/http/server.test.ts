import { describe, expect, it, afterEach } from "vitest";
import { createHuskServer, type HuskServer } from "../../src/http/server.js";
import { SessionManager } from "../../src/session/manager.js";
import type { Session } from "../../src/session/session.js";

function fakeMgr(): SessionManager {
  return new SessionManager(async () => ({
    goto: async () => {},
    snapshot: async () => ({ v: 1, url: "x", count: 0, root: { i: "", r: "", n: "", s: [] } }),
    snapshotDiff: async () => null,
    close: async () => {},
  } as unknown as Session));
}

describe("createHuskServer", () => {
  let server: HuskServer | undefined;
  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it("starts on an ephemeral port and responds to /v1/jsonrpc with health", async () => {
    server = await createHuskServer({
      port: 0,
      host: "127.0.0.1",
      sessions: fakeMgr(),
      version: "0.0.0-test",
      logLevel: "silent",
      vault: { listProfiles: () => [], list: () => [], clear: () => {}, remove: () => {} } as any,
      credentials: { listProfiles: () => [], list: () => [], get: () => null, set: () => {}, remove: () => {}, close: () => {} } as any,
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/v1/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "health" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ jsonrpc: "2.0", id: 1 });
    expect(body.result).toMatchObject({ ok: true, version: "0.0.0-test" });
  });

  it("returns parse error (-32700) on malformed JSON body", async () => {
    server = await createHuskServer({
      port: 0,
      host: "127.0.0.1",
      sessions: fakeMgr(),
      version: "x",
      logLevel: "silent",
      vault: { listProfiles: () => [], list: () => [], clear: () => {}, remove: () => {} } as any,
      credentials: { listProfiles: () => [], list: () => [], get: () => null, set: () => {}, remove: () => {}, close: () => {} } as any,
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/v1/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(200); // JSON-RPC: HTTP 200, error in envelope
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });

  it("returns 405 for non-POST methods", async () => {
    server = await createHuskServer({
      port: 0,
      host: "127.0.0.1",
      sessions: fakeMgr(),
      version: "x",
      logLevel: "silent",
      vault: { listProfiles: () => [], list: () => [], clear: () => {}, remove: () => {} } as any,
      credentials: { listProfiles: () => [], list: () => [], get: () => null, set: () => {}, remove: () => {}, close: () => {} } as any,
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/v1/jsonrpc`, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("stop() closes the listening socket and releases the port", async () => {
    server = await createHuskServer({
      port: 0,
      host: "127.0.0.1",
      sessions: fakeMgr(),
      version: "x",
      logLevel: "silent",
      vault: { listProfiles: () => [], list: () => [], clear: () => {}, remove: () => {} } as any,
      credentials: { listProfiles: () => [], list: () => [], get: () => null, set: () => {}, remove: () => {}, close: () => {} } as any,
    });
    const port = server.port;
    await server.stop();
    server = undefined; // prevent afterEach re-stop
    await expect(
      fetch(`http://127.0.0.1:${port}/v1/jsonrpc`, {
        method: "POST",
        body: "{}",
      })
    ).rejects.toThrow();
  });
});
