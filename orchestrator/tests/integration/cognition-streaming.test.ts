/**
 * Integration test: cognition streaming e2e (subscribe → SSE → events).
 *
 * T10 of M22 Phase E — proves the full SSE delivery path with a real
 * lightpanda session:
 *
 *   1. Subscribe via JSON-RPC `subscribe` → get subscription_id
 *   2. Open SSE stream at /stream/cognition?subscription_id=...
 *   3. Drive an intention that triggers a state_change via IntentionCompiler
 *      (with bus wired in so state_change events flow through CognitionBus)
 *   4. Assert: event(s) delivered over SSE within timeout
 *
 * Skipped when LIGHTPANDA_BIN is unset.
 *
 * Note on `session.intend()` vs direct IntentionCompiler:
 *   `session.intend()` creates IntentionCompiler without the cognitionBus
 *   (a known gap in the current wiring — T8 wires the bus at the HTTP layer
 *   for session creation, but the compiler instantiation in session.ts line
 *   ~1623 does not thread `this._cognitionBus` into CompilerOptions).
 *   This test uses IntentionCompiler directly with the shared bus so that
 *   state_change events actually fire, proving the SSE delivery path
 *   end-to-end without requiring source changes.
 */

import { describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Session } from "../../src/session/session.js";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { CognitionStorage } from "../../src/cognition/storage.js";
import { IntentionStore } from "../../src/cognition/intention-store.js";
import { CognitionBus } from "../../src/cognition/cognition-bus.js";
import { IntentionCompiler } from "../../src/cognition/intention-compiler.js";
import { locateLightpanda } from "../../src/engine/binary.js";
import { createHuskServer, type HuskServer } from "../../src/http/server.js";
import { SessionManager } from "../../src/session/manager.js";

// ---------------------------------------------------------------------------
// Skip guard — only run when lightpanda binary is available.
// ---------------------------------------------------------------------------

const integrationOrSkip = await (async () => {
  try {
    await locateLightpanda();
    return describe;
  } catch {
    return describe.skip;
  }
})();

// ---------------------------------------------------------------------------
// Fixture HTML pages
// ---------------------------------------------------------------------------

const PAGE_A_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Page A</title></head>
<body><main><h1>Page A</h1></main></body>
</html>`;

const PAGE_B_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Page B</title></head>
<body><main><h1>Page B</h1></main></body>
</html>`;

// ---------------------------------------------------------------------------
// Fixture HTTP server
// ---------------------------------------------------------------------------

interface FixtureServer {
  port: number;
  close(): Promise<void>;
}

async function startFixture(): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    if (req.url === "/page-b" || req.url?.startsWith("/page-b?")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE_B_HTML);
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE_A_HTML);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

// ---------------------------------------------------------------------------
// HuskServer factory — starts with a shared CognitionBus on a random port.
// ---------------------------------------------------------------------------

async function startHuskServer(bus: CognitionBus): Promise<HuskServer> {
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

  // Fake session factory — sessions are created directly in each test below;
  // the manager is only needed for the JSON-RPC subscribe/unsubscribe path.
  const sessions = new SessionManager(async () => {
    throw new Error("SessionManager.create should not be called in this test");
  });

  return createHuskServer({
    host: "127.0.0.1",
    port: 0,
    sessions,
    version: "test",
    logLevel: "silent",
    vault: fakeVault,
    credentials: fakeCreds,
    cognitionBus: bus,
  });
}

// ---------------------------------------------------------------------------
// Helper: call a JSON-RPC method on the running HuskServer.
// ---------------------------------------------------------------------------

async function rpc<T>(
  baseUrl: string,
  method: string,
  params: unknown,
): Promise<T> {
  const res = await fetch(`${baseUrl}/v1/jsonrpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) {
    throw new Error(`JSON-RPC error (${method}): ${body.error.message}`);
  }
  return body.result as T;
}

// ---------------------------------------------------------------------------
// Helper: read SSE events until `maxEvents` arrive or `timeoutMs` elapses.
// ---------------------------------------------------------------------------

async function collectSseEvents(
  url: string,
  maxEvents: number,
  timeoutMs: number,
  abortCtrl: AbortController,
): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  let res: Response;

  try {
    res = await fetch(url, { signal: abortCtrl.signal });
  } catch {
    return events; // aborted before connection or 404
  }

  if (!res.ok || !res.body) return events;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const deadline = Date.now() + timeoutMs;

  while (events.length < maxEvents && Date.now() < deadline && !abortCtrl.signal.aborted) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    let value: Uint8Array | undefined;
    let done: boolean;

    try {
      ({ value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((r) =>
          setTimeout(() => r({ value: undefined, done: true as const }), remaining),
        ),
      ]));
    } catch {
      break;
    }

    if (done || value === undefined) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse complete SSE frames (separated by double newline).
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>;
            events.push(parsed);
          } catch {
            // malformed — skip
          }
        }
      }
    }
  }

  reader.releaseLock();
  return events;
}

// ---------------------------------------------------------------------------
// Helper: build a SessionAdapter from a live Session for use with the compiler.
// ---------------------------------------------------------------------------

function makeAdapter(
  session: Session,
): import("../../src/cognition/intention-compiler.js").SessionAdapter {
  return {
    get id() { return session.id; },
    currentUrl: () => (session as unknown as { currentUrl: string }).currentUrl,
    snapshot: () => session.snapshot(),
    click: (id) => session.click(id).then(() => {}),
    type: (id, text) => session.type(id, text).then(() => {}),
    pressKey: (key) => session.press_key(key).then(() => {}),
    scroll: (a) =>
      session
        .scroll(
          a.stable_id != null ? { stable_id: a.stable_id } : null,
          a.direction as import("../../src/session/actions.js").ScrollDirection,
          a.amount_px ?? 800,
        )
        .then(() => {}),
    navigate: (url) => session.goto(url).then(() => {}),
    recentNetwork: () =>
      session.networkBuffer
        .recent()
        .map((e) => ({ method: e.method, url: e.url, status: e.status, ts: e.started_at })),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

integrationOrSkip(
  "cognition streaming e2e (lightpanda)",
  () => {
    // -------------------------------------------------------------------------
    // Test 1: state_change subscription receives an event after intention runs
    // -------------------------------------------------------------------------
    it(
      "Test 1: state_change subscription delivers event over SSE when intention executes",
      async () => {
        const suffix = randomBytes(8).toString("hex");
        const cacheDir = join(tmpdir(), `husk-stream-t1-${suffix}`);
        const cache = new SiteGraphCache({ cacheDir });
        const storage = new CognitionStorage(cache);
        const intentionStore = new IntentionStore(cache.db);
        const fixture = await startFixture();
        const site = "127.0.0.1";
        const now = Date.now();
        const bus = new CognitionBus();
        let husk: HuskServer | undefined;
        let session: Session | undefined;
        const sseAbort = new AbortController();

        try {
          // --- Pre-seed cognition data ---
          storage.upsertState({
            site,
            state_id: "page_a",
            identify_by: { type: "url_pattern", regex: "/page-a" },
            affordances: ["visit_b"],
            observed_count: 1,
            confidence: 0.9,
            last_seen_at: now,
          });

          storage.upsertState({
            site,
            state_id: "page_b",
            identify_by: { type: "url_pattern", regex: "/page-b" },
            affordances: [],
            observed_count: 1,
            confidence: 0.9,
            last_seen_at: now,
          });

          storage.upsertTransition({
            site,
            from_state: "page_a",
            to_state: "page_b",
            action_sequence: [
              { verb: "navigate", url: `http://127.0.0.1:${fixture.port}/page-b` },
            ],
            success_count: 1,
            failure_count: 0,
            avg_duration_ms: 200,
            confidence: 0.9,
            last_used_at: now,
          });

          intentionStore.upsert({
            site,
            name: "visit_b",
            args_schema: {},
            requires_state: "page_b",
            steps: [],
            verify: [{ type: "url", pattern: "/page-b", description: "landed on page-b" }],
            failure_modes: [],
            created_at: now,
            updated_at: now,
          });

          // --- Start HuskServer with shared bus ---
          husk = await startHuskServer(bus);
          const baseUrl = `http://127.0.0.1:${husk.port}`;

          // --- Subscribe via JSON-RPC ---
          const { subscription_id } = await rpc<{ subscription_id: string; stream_url: string }>(
            baseUrl,
            "subscribe",
            { event_type: "state_change", session_id: "*" },
          );
          expect(typeof subscription_id).toBe("string");

          // --- Create real Session with cognitionBus ---
          session = await Session.create({
            readinessTimeoutMs: 15_000,
            siteGraph: cache,
            cognitionBus: bus,
          });

          // Navigate to page-a so the state matches page_a at compiler start.
          await session.goto(`http://127.0.0.1:${fixture.port}/page-a`);

          // --- Open SSE stream ---
          const sseUrl = `${baseUrl}/stream/cognition?subscription_id=${subscription_id}`;
          // Start collecting in background — we read for up to 5 s or until 1 event.
          const eventsPromise = collectSseEvents(sseUrl, 1, 5_000, sseAbort);

          // Give SSE connection a moment to establish (setHandler wires on connect).
          await new Promise<void>((r) => setTimeout(r, 150));

          // --- Execute intention via IntentionCompiler with bus wired in ---
          // We use IntentionCompiler directly (not session.intend()) because
          // session.intend() currently creates the compiler without the cognitionBus.
          // Direct compiler usage ensures state_change events flow through the bus.
          const graph = new CognitionStorage(cache).loadStateGraph(site);
          const compiler = new IntentionCompiler({ graph, site, bus });
          const intention = intentionStore.get(site, "visit_b");
          expect(intention).toBeTruthy();

          const adapter = makeAdapter(session);
          const outcome = await compiler.execute(adapter, intention!, {});

          // Intention should fail or succeed — either way, we care about SSE events.
          // The compiler emits state_change when the transition arrives at page_b.
          console.log(
            `[T1] intention outcome: ok=${outcome.ok} reason=${(outcome as any).reason ?? "none"}`,
          );

          // --- Wait for SSE events ---
          const events = await eventsPromise;
          console.log(`[T1] SSE events received: ${events.length}`, JSON.stringify(events));

          // Assert: at least one state_change event received.
          expect(events.length).toBeGreaterThanOrEqual(1);
          const ev = events[0];
          expect(ev.type).toBe("state_change");
          expect((ev.payload as any).to_state).toBe("page_b");
        } finally {
          sseAbort.abort();
          await session?.close();
          await fixture.close();
          await husk?.stop();
          cache.close();
          rmSync(cacheDir, { recursive: true, force: true });
        }
      },
      60_000,
    );

    // -------------------------------------------------------------------------
    // Test 2: unsubscribe stops delivery
    // -------------------------------------------------------------------------
    it(
      "Test 2: unsubscribe stops SSE delivery",
      async () => {
        const suffix = randomBytes(8).toString("hex");
        const cacheDir = join(tmpdir(), `husk-stream-t2-${suffix}`);
        const cache = new SiteGraphCache({ cacheDir });
        const bus = new CognitionBus();
        let husk: HuskServer | undefined;
        const sseAbort = new AbortController();

        try {
          husk = await startHuskServer(bus);
          const baseUrl = `http://127.0.0.1:${husk.port}`;

          // Subscribe then immediately unsubscribe.
          const { subscription_id } = await rpc<{
            subscription_id: string;
            stream_url: string;
          }>(baseUrl, "subscribe", {
            event_type: "state_change",
            session_id: "*",
          });

          await rpc<{ removed: boolean }>(baseUrl, "unsubscribe", {
            subscription_id,
          });

          // SSE endpoint should return 404 (subscription no longer exists).
          const sseUrl = `${baseUrl}/stream/cognition?subscription_id=${subscription_id}`;
          let sseStatus: number;
          try {
            const res = await fetch(sseUrl, { signal: sseAbort.signal });
            sseStatus = res.status;
            await res.body?.cancel();
          } catch {
            // fetch aborted or connection refused — treat as "no events"
            sseStatus = 0;
          }

          // After unsubscribe, SSE should be 404 (subscription not found).
          // If the server responded with something other than 200, no events can arrive.
          expect(sseStatus).not.toBe(200);
        } finally {
          sseAbort.abort();
          await husk?.stop();
          cache.close();
          rmSync(cacheDir, { recursive: true, force: true });
        }
      },
      30_000,
    );

    // -------------------------------------------------------------------------
    // Test 3: multiple events — subscribe, trigger two transitions, assert ≥2 events
    // -------------------------------------------------------------------------
    it(
      "Test 3: multiple state_change events arrive for sequential transitions",
      async () => {
        const suffix = randomBytes(8).toString("hex");
        const cacheDir = join(tmpdir(), `husk-stream-t3-${suffix}`);
        const cache = new SiteGraphCache({ cacheDir });
        const storage = new CognitionStorage(cache);
        const intentionStore = new IntentionStore(cache.db);
        const fixture = await startFixture();
        const site = "127.0.0.1";
        const now = Date.now();
        const bus = new CognitionBus();
        let husk: HuskServer | undefined;
        let session: Session | undefined;
        const sseAbort = new AbortController();

        try {
          // Seed page_a, page_b, and a round-trip page_b→page_a transition.
          storage.upsertState({
            site,
            state_id: "page_a",
            identify_by: { type: "url_pattern", regex: "/page-a" },
            affordances: ["visit_b"],
            observed_count: 1,
            confidence: 0.9,
            last_seen_at: now,
          });

          storage.upsertState({
            site,
            state_id: "page_b",
            identify_by: { type: "url_pattern", regex: "/page-b" },
            affordances: ["visit_a"],
            observed_count: 1,
            confidence: 0.9,
            last_seen_at: now,
          });

          // Transition: page_a → page_b
          storage.upsertTransition({
            site,
            from_state: "page_a",
            to_state: "page_b",
            action_sequence: [
              { verb: "navigate", url: `http://127.0.0.1:${fixture.port}/page-b` },
            ],
            success_count: 1,
            failure_count: 0,
            avg_duration_ms: 200,
            confidence: 0.9,
            last_used_at: now,
          });

          // Intention 1: visit_b (navigate to page_b, requires page_b)
          intentionStore.upsert({
            site,
            name: "visit_b",
            args_schema: {},
            requires_state: "page_b",
            steps: [],
            verify: [{ type: "url", pattern: "/page-b", description: "on page-b" }],
            failure_modes: [],
            created_at: now,
            updated_at: now,
          });

          // Intention 2: visit_b_again (same destination, executed from page_a)
          intentionStore.upsert({
            site,
            name: "visit_b_again",
            args_schema: {},
            requires_state: "page_b",
            steps: [],
            verify: [{ type: "url", pattern: "/page-b", description: "on page-b again" }],
            failure_modes: [],
            created_at: now,
            updated_at: now,
          });

          husk = await startHuskServer(bus);
          const baseUrl = `http://127.0.0.1:${husk.port}`;

          // Subscribe for state_change events.
          const { subscription_id } = await rpc<{
            subscription_id: string;
            stream_url: string;
          }>(baseUrl, "subscribe", {
            event_type: "state_change",
            session_id: "*",
          });

          // Create session on page_a.
          session = await Session.create({
            readinessTimeoutMs: 15_000,
            siteGraph: cache,
            cognitionBus: bus,
          });
          await session.goto(`http://127.0.0.1:${fixture.port}/page-a`);

          // Open SSE stream.
          const sseUrl = `${baseUrl}/stream/cognition?subscription_id=${subscription_id}`;
          const eventsPromise = collectSseEvents(sseUrl, 2, 10_000, sseAbort);

          // Give SSE connection a moment to establish.
          await new Promise<void>((r) => setTimeout(r, 150));

          // Execute first intention: page_a → page_b.
          const graph = new CognitionStorage(cache).loadStateGraph(site);
          const compiler1 = new IntentionCompiler({ graph, site, bus });
          const intention1 = intentionStore.get(site, "visit_b")!;
          const adapter = makeAdapter(session);
          await compiler1.execute(adapter, intention1, {});

          // Navigate back to page_a manually then run second intention.
          await session.goto(`http://127.0.0.1:${fixture.port}/page-a`);
          const graph2 = new CognitionStorage(cache).loadStateGraph(site);
          const compiler2 = new IntentionCompiler({ graph: graph2, site, bus });
          const intention2 = intentionStore.get(site, "visit_b_again")!;
          const adapter2 = makeAdapter(session);
          await compiler2.execute(adapter2, intention2, {});

          // Wait for SSE events.
          const events = await eventsPromise;
          console.log(
            `[T3] SSE events received: ${events.length}`,
            JSON.stringify(events),
          );

          // Assert: at least 2 state_change events.
          expect(events.length).toBeGreaterThanOrEqual(2);
          for (const ev of events) {
            expect(ev.type).toBe("state_change");
          }
        } finally {
          sseAbort.abort();
          await session?.close();
          await fixture.close();
          await husk?.stop();
          cache.close();
          rmSync(cacheDir, { recursive: true, force: true });
        }
      },
      60_000,
    );

    // -------------------------------------------------------------------------
    // Test 4: session.intend() now threads cognitionBus to IntentionCompiler
    // -------------------------------------------------------------------------
    it(
      "Test 4: session.intend() delivers state_change events over SSE (via threaded cognitionBus)",
      async () => {
        const suffix = randomBytes(8).toString("hex");
        const cacheDir = join(tmpdir(), `husk-stream-t4-${suffix}`);
        const cache = new SiteGraphCache({ cacheDir });
        const storage = new CognitionStorage(cache);
        const intentionStore = new IntentionStore(cache.db);
        const fixture = await startFixture();
        const site = "127.0.0.1";
        const now = Date.now();
        const bus = new CognitionBus();
        let husk: HuskServer | undefined;
        let session: Session | undefined;
        const sseAbort = new AbortController();

        try {
          // --- Pre-seed cognition data ---
          storage.upsertState({
            site,
            state_id: "page_a",
            identify_by: { type: "url_pattern", regex: "/page-a" },
            affordances: ["visit_b"],
            observed_count: 1,
            confidence: 0.9,
            last_seen_at: now,
          });

          storage.upsertState({
            site,
            state_id: "page_b",
            identify_by: { type: "url_pattern", regex: "/page-b" },
            affordances: [],
            observed_count: 1,
            confidence: 0.9,
            last_seen_at: now,
          });

          storage.upsertTransition({
            site,
            from_state: "page_a",
            to_state: "page_b",
            action_sequence: [
              { verb: "navigate", url: `http://127.0.0.1:${fixture.port}/page-b` },
            ],
            success_count: 1,
            failure_count: 0,
            avg_duration_ms: 200,
            confidence: 0.9,
            last_used_at: now,
          });

          intentionStore.upsert({
            site,
            name: "visit_b",
            args_schema: {},
            requires_state: "page_b",
            steps: [],
            verify: [{ type: "url", pattern: "/page-b", description: "landed on page-b" }],
            failure_modes: [],
            created_at: now,
            updated_at: now,
          });

          // --- Start HuskServer with shared bus ---
          husk = await startHuskServer(bus);
          const baseUrl = `http://127.0.0.1:${husk.port}`;

          // --- Subscribe via JSON-RPC ---
          const { subscription_id } = await rpc<{ subscription_id: string; stream_url: string }>(
            baseUrl,
            "subscribe",
            { event_type: "state_change", session_id: "*" },
          );
          expect(typeof subscription_id).toBe("string");

          // --- Create real Session with cognitionBus ---
          session = await Session.create({
            readinessTimeoutMs: 15_000,
            siteGraph: cache,
            cognitionBus: bus,
          });

          // Navigate to page-a so the state matches page_a at compiler start.
          await session.goto(`http://127.0.0.1:${fixture.port}/page-a`);

          // --- Open SSE stream ---
          const sseUrl = `${baseUrl}/stream/cognition?subscription_id=${subscription_id}`;
          // Start collecting in background — we read for up to 5 s or until 1 event.
          const eventsPromise = collectSseEvents(sseUrl, 1, 5_000, sseAbort);

          // Give SSE connection a moment to establish (setHandler wires on connect).
          await new Promise<void>((r) => setTimeout(r, 150));

          // --- Execute intention via session.intend() ---
          // With the M22 Phase E T11 fix, session.intend() now threads cognitionBus
          // to IntentionCompiler, so state_change events should flow through the bus.
          const outcome = await session.intend({
            intention_name: "visit_b",
          });

          console.log(
            `[T4] intention outcome: ok=${outcome.ok} reason=${(outcome as any).reason ?? "none"}`,
          );

          // --- Wait for SSE events ---
          const events = await eventsPromise;
          console.log(`[T4] SSE events received: ${events.length}`, JSON.stringify(events));

          // Assert: at least one state_change event received.
          expect(events.length).toBeGreaterThanOrEqual(1);
          const ev = events[0];
          expect(ev.type).toBe("state_change");
          expect((ev.payload as any).to_state).toBe("page_b");
        } finally {
          sseAbort.abort();
          await session?.close();
          await fixture.close();
          await husk?.stop();
          cache.close();
          rmSync(cacheDir, { recursive: true, force: true });
        }
      },
      60_000,
    );
  },
);
