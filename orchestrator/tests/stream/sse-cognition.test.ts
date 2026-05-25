import { describe, it, expect, afterEach } from "vitest";
import { createHuskServer, type HuskServer } from "../../src/http/server.js";
import { CognitionBus } from "../../src/cognition/cognition-bus.js";
import { SessionManager } from "../../src/session/manager.js";
import type { Session } from "../../src/session/session.js";
import type { CognitionEvent } from "../../src/cognition/events.js";

function fakeSession(): Session {
  return {
    goto: async () => {},
    snapshot: async () => ({ v: 1, url: "x", count: 0, root: { i: "", r: "", n: "", s: [] } }),
    snapshotDiff: async () => null,
    close: async () => {},
  } as unknown as Session;
}

const fakeVault = {
  listProfiles: () => [],
  list: () => [],
  clear: () => {},
  remove: () => {},
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const fakeCreds = {
  listProfiles: () => [],
  list: () => [],
  get: () => null,
  set: () => {},
  remove: () => {},
  close: () => {},
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

function makeEvent(overrides: Partial<CognitionEvent> = {}): CognitionEvent {
  return {
    id: "evt-1",
    ts: Date.now(),
    session_id: "s1",
    type: "state_change",
    payload: { from_state: null, to_state: "home" },
    ...overrides,
  } as CognitionEvent;
}

async function startServer(cognitionBus: CognitionBus): Promise<HuskServer> {
  const sessions = new SessionManager(async () => fakeSession());
  return createHuskServer({
    host: "127.0.0.1",
    port: 0,
    sessions,
    version: "test",
    logLevel: "silent",
    vault: fakeVault,
    credentials: fakeCreds,
    cognitionBus,
  });
}

describe("/stream/cognition SSE endpoint", () => {
  let server: HuskServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it("returns 400 when subscription_id is absent", async () => {
    const bus = new CognitionBus();
    server = await startServer(bus);
    const res = await fetch(`http://127.0.0.1:${server.port}/stream/cognition`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("missing subscription_id");
  });

  it("returns 404 when subscription_id does not match any subscription", async () => {
    const bus = new CognitionBus();
    server = await startServer(bus);
    const res = await fetch(
      `http://127.0.0.1:${server.port}/stream/cognition?subscription_id=no-such-id`,
    );
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain("subscription not found");
  });

  it("returns 200 with SSE headers and delivers a data line when bus.publish fires", async () => {
    const bus = new CognitionBus();
    server = await startServer(bus);

    // Register a subscription on the bus first (as JSON-RPC subscribe would in T8).
    const subId = bus.subscribe("state_change", { session_id: "*" }, () => {});

    const ac = new AbortController();
    const res = await fetch(
      `http://127.0.0.1:${server.port}/stream/cognition?subscription_id=${subId}`,
      { signal: ac.signal },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("cache-control")).toMatch(/no-cache/);

    // Collect chunks for ~300ms then abort.
    const chunks: string[] = [];
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Publish an event shortly after the SSE connection is established.
    const publishTimer = setTimeout(() => {
      bus.publish(makeEvent());
    }, 50);

    // Read until we see a data line or time out.
    const deadline = Date.now() + 500;
    let received = "";
    while (Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((r) =>
          setTimeout(() => r({ value: undefined, done: true as const }), 400),
        ),
      ]);
      if (done || value === undefined) break;
      const chunk = decoder.decode(value, { stream: true });
      chunks.push(chunk);
      received += chunk;
      if (received.includes("data:")) break;
    }

    clearTimeout(publishTimer);
    ac.abort();
    reader.releaseLock();

    expect(received).toMatch(/^data: /m);
    const dataLine = received.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice(6));
    expect(parsed.type).toBe("state_change");
  });

  it("unsubscribes the subscription when the client disconnects", async () => {
    const bus = new CognitionBus();
    server = await startServer(bus);

    const subId = bus.subscribe("state_change", { session_id: "*" }, () => {});
    expect(bus.listSubscriptions()).toHaveLength(1);

    const ac = new AbortController();
    const res = await fetch(
      `http://127.0.0.1:${server.port}/stream/cognition?subscription_id=${subId}`,
      { signal: ac.signal },
    );
    expect(res.status).toBe(200);

    // Give the server a moment to set up the handler, then abort.
    await new Promise<void>((r) => setTimeout(r, 50));
    ac.abort();

    // Give the server a moment to process the close event.
    await new Promise<void>((r) => setTimeout(r, 100));

    expect(bus.listSubscriptions()).toHaveLength(0);
  });
});
