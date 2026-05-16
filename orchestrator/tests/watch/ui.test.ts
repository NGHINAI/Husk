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

describe("/watch HTML route", () => {
  let server: HuskServer | undefined;
  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it("serves the watch HTML when bound to 127.0.0.1 with a WatchBus", async () => {
    const watchBus = new WatchBus();
    const sessions = new SessionManager(async () => fakeSession(), watchBus);
    server = await createHuskServer({
      host: "127.0.0.1",
      port: 0,
      sessions,
      version: "test",
      logLevel: "silent",
      vault: fakeVault,
      credentials: fakeCreds,
      watchBus,
    });

    const r = await fetch(`http://127.0.0.1:${server.port}/watch`);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain("husk · /watch");
    expect(body).toContain("EventSource");
    expect(body).toContain("session_id");
  });

  it("does NOT serve /watch when bound to 0.0.0.0", async () => {
    const watchBus = new WatchBus();
    const sessions = new SessionManager(async () => fakeSession(), watchBus);
    server = await createHuskServer({
      host: "0.0.0.0",
      port: 0,
      sessions,
      version: "test",
      logLevel: "silent",
      vault: fakeVault,
      credentials: fakeCreds,
      watchBus,
    });

    const r = await fetch(`http://127.0.0.1:${server.port}/watch`);
    expect(r.status).toBe(404);
  });

  it("does NOT serve /watch when watchBus is absent (even on 127.0.0.1)", async () => {
    const sessions = new SessionManager(async () => fakeSession());
    server = await createHuskServer({
      host: "127.0.0.1",
      port: 0,
      sessions,
      version: "test",
      logLevel: "silent",
      vault: fakeVault,
      credentials: fakeCreds,
      // no watchBus
    });

    const r = await fetch(`http://127.0.0.1:${server.port}/watch`);
    expect(r.status).toBe(404);
  });
});
