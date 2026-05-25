# Husk M22 — Phase E: Streaming Protocol + Subscription Bus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Push events to agents instead of making them poll. Five event types in Phase E: `state_change`, `network_idle`, `error_appeared`, `captcha_detected`, `user_intervention_required`. Delivered over SSE on a new endpoint; subscribed via JSON-RPC. The agent registers filters (by session_id, by site, with optional debounce) and receives events as they fire.

**Architecture:** A process-wide `CognitionBus` owns subscription state. Components (IntentionCompiler, Session.snapshot, page-health detector, HumanIOBus) publish events into it. A new SSE endpoint `/stream/cognition` delivers matching events to subscribed agents. JSON-RPC `subscribe(event_type, filter?, debounce_ms?)` registers a subscription and returns a subscription_id + the SSE URL.

**Tech Stack:** TypeScript orchestrator only. No new dependencies (SSE is plain HTTP). M13's `WatchBus` is the pattern to mirror but at process scope, not per-session.

**Locked decisions honored (v0.1 spec §16):**
- LLM-neutral — event emission is purely state-driven (no LLM classification)
- Conservative trust — every event carries `ts` + `session_id` + structured `payload`; never lossy
- MCP surface unchanged for Phase E (subscription is SDK + JSON-RPC; husk_subscribe is Phase F consolidation)

**Explicitly deferred (NOT Phase E scope):**
- `new_data` event type — site-specific (Gmail unread, Slack messages); needs pluggable detectors
- `rate_limit_approaching` / `rate_limit_window_reset` — requires per-site policy detection
- "real-user" engine (the third capability target) — needs Watch UI surface work that's larger than Phase E
- Event replay / buffering for late subscribers — agents subscribe before action; missed events are lost (acceptable for v0.1)
- Cross-orchestrator event federation

**Spec references:** v0.1 §4.5 (subscription bus), §7 (streaming protocol).

---

## File Structure

### New files

```
orchestrator/src/cognition/
  events.ts                 # CognitionEvent type union + EventFilter
  cognition-bus.ts          # CognitionBus class (subscribe/publish/filter/debounce)
  event-emitters.ts         # state_change / network_idle / error_appeared emitters

orchestrator/src/stream/
  sse-cognition.ts          # SSE endpoint at /stream/cognition?subscription_id=...
```

### Modified files

```
orchestrator/src/cognition/intention-compiler.ts   # publish state_change after each transition
orchestrator/src/session/session.ts                # publish network_idle from network buffer settle
orchestrator/src/engine/page-health.ts             # expose detectCaptcha() + detectErrorBanner() helpers
orchestrator/src/hitl/bus.ts                       # publish user_intervention_required when paused
orchestrator/src/http/methods.ts                   # subscribe / unsubscribe JSON-RPC methods
orchestrator/src/http/server.ts                    # register /stream/cognition route
sdk-ts/src/types.ts                                # CognitionEvent + EventFilter types
sdk-ts/src/husk.ts (or session.ts)                 # husk.subscribe(...)
sdk-py/husk/_types.py                              # mirror
sdk-py/husk/_husk.py                               # husk.subscribe(...)
```

### Test files

```
orchestrator/tests/cognition/cognition-bus.test.ts
orchestrator/tests/cognition/event-emitters.test.ts
orchestrator/tests/stream/sse-cognition.test.ts
orchestrator/tests/integration/cognition-streaming.test.ts
```

---

## Task 1 — Event types + filter

**Model:** Haiku.

### Files

- Create: `orchestrator/src/cognition/events.ts`
- Create: `orchestrator/tests/cognition/events.test.ts`

### events.ts

```typescript
/**
 * Cognition event types — what agents can subscribe to.
 *
 * Each event has a `type`, `session_id`, `ts`, `site?`, and a typed `payload`.
 */

export type EventType =
  | "state_change"
  | "network_idle"
  | "error_appeared"
  | "captcha_detected"
  | "user_intervention_required";

export interface BaseEvent {
  /** Globally unique event id (uuid). */
  id: string;
  /** Unix ms. */
  ts: number;
  /** Which session produced this event. */
  session_id: string;
  /** Hostname when known. */
  site?: string;
}

export type CognitionEvent =
  | (BaseEvent & {
      type: "state_change";
      payload: { from_state: string | null; to_state: string; confidence?: number };
    })
  | (BaseEvent & {
      type: "network_idle";
      payload: { idle_since: number; in_flight_count: number };
    })
  | (BaseEvent & {
      type: "error_appeared";
      payload: { kind: "banner" | "console" | "dialog"; text: string };
    })
  | (BaseEvent & {
      type: "captcha_detected";
      payload: { kind: string; reasons: string[] };
    })
  | (BaseEvent & {
      type: "user_intervention_required";
      payload: { reason: "ask_human" | "handoff" | "needs_credentials" | "needs_2fa_code"; question_id?: string };
    });

/** Filter applied at subscription time. */
export interface EventFilter {
  /** When set, only events matching this session_id are delivered. "*" matches all. */
  session_id?: string;
  /** When set, only events from this site (hostname) are delivered. */
  site?: string;
  /** Optional debounce in ms — coalesces same-type events from the same session_id. */
  debounce_ms?: number;
}

/** Subscription record stored on the bus. */
export interface Subscription {
  id: string;
  event_type: EventType;
  filter: EventFilter;
  created_at: number;
  /** Last-emit ts for debounce purposes (per session_id). */
  last_emit_ts?: Map<string, number>;
}
```

### Tests (events.test.ts)

```typescript
import { describe, it, expect } from "vitest";
import type { CognitionEvent, EventFilter } from "../../src/cognition/events.js";

describe("cognition events", () => {
  it("each event type compiles with required payload", () => {
    const events: CognitionEvent[] = [
      { id: "e1", ts: 1, session_id: "s", type: "state_change", payload: { from_state: null, to_state: "home" } },
      { id: "e2", ts: 2, session_id: "s", type: "network_idle", payload: { idle_since: 100, in_flight_count: 0 } },
      { id: "e3", ts: 3, session_id: "s", type: "error_appeared", payload: { kind: "banner", text: "Error" } },
      { id: "e4", ts: 4, session_id: "s", type: "captcha_detected", payload: { kind: "recaptcha", reasons: [] } },
      { id: "e5", ts: 5, session_id: "s", type: "user_intervention_required", payload: { reason: "ask_human" } },
    ];
    expect(events).toHaveLength(5);
  });

  it("EventFilter supports session_id, site, debounce_ms", () => {
    const f: EventFilter = { session_id: "s1", site: "linkedin.com", debounce_ms: 500 };
    expect(f.debounce_ms).toBe(500);
  });
});
```

### TDD

- [ ] **Step 1: Write tests** → FAIL.
- [ ] **Step 2: Write events.ts.**
- [ ] **Step 3: Run** → PASS.
- [ ] **Step 4: Full suite: 901 + 2 = 903.**
- [ ] **Step 5: Commit:**

```bash
git add orchestrator/src/cognition/events.ts orchestrator/tests/cognition/events.test.ts
git commit -m "feat(cognition): event types + filter for streaming bus"
```

---

## Task 2 — CognitionBus class

**Model:** Sonnet — load-bearing infrastructure.

### Files

- Create: `orchestrator/src/cognition/cognition-bus.ts`
- Create: `orchestrator/tests/cognition/cognition-bus.test.ts`

### cognition-bus.ts

```typescript
import { randomUUID } from "node:crypto";
import type { CognitionEvent, EventFilter, EventType, Subscription } from "./events.js";

/**
 * In-process pub/sub for cognition events.
 *
 * Subscribers register a (event_type, filter) tuple; the bus invokes their
 * handler when a matching event is published. Optional per-subscription
 * debounce coalesces same-type events from the same session_id.
 */
export class CognitionBus {
  private readonly subscriptions = new Map<string, Subscription & { handler: (e: CognitionEvent) => void }>();

  subscribe(
    event_type: EventType,
    filter: EventFilter,
    handler: (e: CognitionEvent) => void,
  ): string {
    const id = randomUUID();
    this.subscriptions.set(id, {
      id,
      event_type,
      filter,
      created_at: Date.now(),
      handler,
      last_emit_ts: filter.debounce_ms ? new Map() : undefined,
    });
    return id;
  }

  unsubscribe(id: string): boolean {
    return this.subscriptions.delete(id);
  }

  publish(event: CognitionEvent): void {
    for (const sub of this.subscriptions.values()) {
      if (!this.matches(sub, event)) continue;
      if (sub.filter.debounce_ms && sub.last_emit_ts) {
        const last = sub.last_emit_ts.get(event.session_id) ?? 0;
        if (event.ts - last < sub.filter.debounce_ms) continue;
        sub.last_emit_ts.set(event.session_id, event.ts);
      }
      try {
        sub.handler(event);
      } catch {
        // Subscriber errors must not break the bus.
      }
    }
  }

  /** For testing / inspection. */
  listSubscriptions(): Subscription[] {
    return Array.from(this.subscriptions.values()).map(({ handler: _h, ...s }) => s);
  }

  private matches(sub: Subscription, event: CognitionEvent): boolean {
    if (sub.event_type !== event.type) return false;
    const sid = sub.filter.session_id;
    if (sid !== undefined && sid !== "*" && sid !== event.session_id) return false;
    const site = sub.filter.site;
    if (site !== undefined && event.site !== site) return false;
    return true;
  }
}
```

### Tests — 8+ cases

```typescript
import { describe, it, expect, vi } from "vitest";
import { CognitionBus } from "../../src/cognition/cognition-bus.js";

const ev = (overrides: Partial<any> = {}) => ({
  id: "id",
  ts: Date.now(),
  session_id: "s1",
  type: "state_change",
  payload: { from_state: null, to_state: "home" },
  ...overrides,
} as any);

describe("CognitionBus", () => {
  it("delivers events to matching subscribers", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    bus.subscribe("state_change", { session_id: "s1" }, h);
    bus.publish(ev());
    expect(h).toHaveBeenCalledOnce();
  });

  it("filters by event type", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    bus.subscribe("network_idle", {}, h);
    bus.publish(ev({ type: "state_change" }));
    expect(h).not.toHaveBeenCalled();
  });

  it("filters by session_id (exact)", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    bus.subscribe("state_change", { session_id: "s2" }, h);
    bus.publish(ev({ session_id: "s1" }));
    expect(h).not.toHaveBeenCalled();
  });

  it("session_id=* matches all sessions", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    bus.subscribe("state_change", { session_id: "*" }, h);
    bus.publish(ev({ session_id: "s1" }));
    bus.publish(ev({ session_id: "s2" }));
    expect(h).toHaveBeenCalledTimes(2);
  });

  it("filters by site", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    bus.subscribe("state_change", { site: "linkedin.com" }, h);
    bus.publish(ev({ site: "github.com" }));
    bus.publish(ev({ site: "linkedin.com" }));
    expect(h).toHaveBeenCalledOnce();
  });

  it("debounce coalesces same-session events", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    bus.subscribe("state_change", { session_id: "s1", debounce_ms: 100 }, h);
    const t0 = 1000;
    bus.publish(ev({ ts: t0 }));
    bus.publish(ev({ ts: t0 + 50 }));   // within debounce window — dropped
    bus.publish(ev({ ts: t0 + 150 }));  // outside — fires
    expect(h).toHaveBeenCalledTimes(2);
  });

  it("debounce is per-session_id", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    bus.subscribe("state_change", { session_id: "*", debounce_ms: 100 }, h);
    const t0 = 1000;
    bus.publish(ev({ session_id: "s1", ts: t0 }));
    bus.publish(ev({ session_id: "s2", ts: t0 + 50 }));  // different session — fires
    expect(h).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe stops further delivery", () => {
    const bus = new CognitionBus();
    const h = vi.fn();
    const id = bus.subscribe("state_change", {}, h);
    bus.publish(ev());
    bus.unsubscribe(id);
    bus.publish(ev());
    expect(h).toHaveBeenCalledOnce();
  });

  it("handler errors do not break the bus", () => {
    const bus = new CognitionBus();
    const h1 = vi.fn(() => { throw new Error("boom"); });
    const h2 = vi.fn();
    bus.subscribe("state_change", {}, h1);
    bus.subscribe("state_change", {}, h2);
    bus.publish(ev());
    expect(h2).toHaveBeenCalledOnce();
  });

  it("listSubscriptions excludes handler reference", () => {
    const bus = new CognitionBus();
    bus.subscribe("state_change", { session_id: "s1" }, () => {});
    const subs = bus.listSubscriptions();
    expect(subs).toHaveLength(1);
    expect((subs[0] as any).handler).toBeUndefined();
  });
});
```

### TDD

- [ ] Write tests → FAIL.
- [ ] Implement CognitionBus.
- [ ] Re-run → expect 10 PASS.
- [ ] Full suite: 903 + 10 = 913.
- [ ] Commit:

```bash
git add orchestrator/src/cognition/cognition-bus.ts orchestrator/tests/cognition/cognition-bus.test.ts
git commit -m "feat(cognition): CognitionBus — subscribe/publish/filter/debounce"
```

---

## Task 3 — state_change emitter (compiler integration)

**Model:** Sonnet.

### Files

- Create: `orchestrator/src/cognition/event-emitters.ts`
- Modify: `orchestrator/src/cognition/intention-compiler.ts` — accept `bus?: CognitionBus` in CompilerOptions; emit state_change after each transition + at end
- Modify: `orchestrator/tests/cognition/intention-compiler.test.ts` — extend with state_change emission test (or add new test file `intention-compiler-events.test.ts`)

### event-emitters.ts

```typescript
import { randomUUID } from "node:crypto";
import type { CognitionBus } from "./cognition-bus.js";
import type { CognitionEvent } from "./events.js";

/**
 * Emit a state_change event into the bus.
 * Callers should compare from/to themselves; this just publishes.
 */
export function emitStateChange(
  bus: CognitionBus,
  session_id: string,
  site: string,
  from_state: string | null,
  to_state: string,
  confidence?: number,
): void {
  const ev: CognitionEvent = {
    id: randomUUID(),
    ts: Date.now(),
    session_id,
    site,
    type: "state_change",
    payload: { from_state, to_state, ...(confidence !== undefined && { confidence }) },
  };
  bus.publish(ev);
}
```

### Compiler integration

Add `bus?: CognitionBus` to `CompilerOptions`. Wherever the compiler successfully identifies a state (initial identify + after each transition's verification), call `emitStateChange(bus, session_id, site, prev, current)` if the state changed.

Key insight: the compiler already tracks state_before and current state for the Outcome. Hook into those existing logs (`steps_observed`) — for each transition where ok=true and to_state !== from_state, emit state_change.

Don't emit on transitions where state didn't change (no movement = no event).

### Tests

Add `intention-compiler-events.test.ts` with 3 tests:
- Compiler emits state_change for each successful transition
- Compiler emits state_change at end of execute() with final state_before → state_after
- No state_change emitted when from === to

### TDD

- [ ] Write event-emitters.ts.
- [ ] Write tests.
- [ ] Update compiler to thread `bus` + emit.
- [ ] All compiler tests pass.
- [ ] Full suite: 913 + 3 = 916.
- [ ] Commit:

```bash
git add orchestrator/src/cognition/event-emitters.ts \
        orchestrator/src/cognition/intention-compiler.ts \
        orchestrator/tests/cognition/intention-compiler-events.test.ts
git commit -m "feat(cognition): state_change emission from IntentionCompiler"
```

---

## Task 4 — network_idle emitter

**Model:** Sonnet.

### Files

- Modify: `orchestrator/src/cognition/event-emitters.ts` — add `wireNetworkIdle(bus, session)` helper
- Modify: `orchestrator/src/session/session.ts` — call `wireNetworkIdle(this._cognitionBus, this)` at construction when bus is set; or expose `Session.publishNetworkIdle(...)` and trigger from existing network-settle logic
- Create: `orchestrator/tests/cognition/network-idle.test.ts`

### Design

The network ring buffer (M14) already tracks `started_at` per request. A request is "in-flight" when started but not finished. Define network_idle as: zero in-flight AND last activity ≥ debounce ms ago.

The cleanest hook: each time a network response completes, check `inFlight === 0`; if so, schedule a timer for `debounce_ms` (default 500); when timer fires AND inFlight is still 0, publish network_idle.

Implementation sketch:

```typescript
// in event-emitters.ts
import type { Session } from "../session/session.js";  // or appropriate interface

export function wireNetworkIdle(bus: CognitionBus, session: Session, debounce_ms = 500): () => void {
  let timer: NodeJS.Timeout | null = null;
  const check = () => {
    if (session.networkBuffer.inFlightCount() === 0) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (session.networkBuffer.inFlightCount() === 0) {
          bus.publish({
            id: randomUUID(),
            ts: Date.now(),
            session_id: session.id,
            site: session.currentSite(),
            type: "network_idle",
            payload: { idle_since: Date.now() - debounce_ms, in_flight_count: 0 },
          });
        }
      }, debounce_ms);
    }
  };
  const unsub = session.networkBuffer.onResponseComplete(check);  // assumes such a hook exists; if not, this task may need to add a minimal one
  return () => { if (timer) clearTimeout(timer); unsub(); };
}
```

Read NetworkBuffer in `orchestrator/src/session/network.ts` (or wherever) to learn what hooks exist. If no `onResponseComplete` hook exists, add a minimal listener pattern there (1-line change).

### Tests

Unit test using a stub session + stub network buffer with controllable inFlightCount and a manual trigger for "response complete". Validate:
- After response complete with 0 in-flight, network_idle fires after debounce_ms
- A new request before debounce expires cancels the pending event
- Multiple rapid response completes are coalesced into one network_idle

Use `vi.useFakeTimers()` and `vi.advanceTimersByTime` for deterministic timer tests.

### TDD

- [ ] Read network.ts to confirm available hooks.
- [ ] Add hook if missing.
- [ ] Write tests with fake timers.
- [ ] Implement wireNetworkIdle.
- [ ] Wire it from Session constructor (only when bus is set).
- [ ] Full suite + new tests pass.
- [ ] Commit:

```bash
git add orchestrator/src/cognition/event-emitters.ts \
        orchestrator/src/session/network.ts orchestrator/src/session/session.ts \
        orchestrator/tests/cognition/network-idle.test.ts
git commit -m "feat(cognition): network_idle emitter (debounced settle detection)"
```

---

## Task 5 — captcha_detected + error_appeared emitters

**Model:** Sonnet.

### Files

- Modify: `orchestrator/src/cognition/event-emitters.ts` — add `emitCaptchaIfDetected(bus, session, snapshot)` + `emitErrorIfPresent(bus, session, snapshot)`
- Modify: `orchestrator/src/session/session.ts` — call these inside the snapshot post-processing path (where M14 already inspects snapshots)
- Modify: `orchestrator/src/engine/page-health.ts` — expose `detectCaptchaPatterns(snapshot)` if not already exposed
- Create: `orchestrator/tests/cognition/event-emitters.test.ts`

### Implementation notes

- **captcha_detected**: Reuse M17 page-health markers. The existing `detectPageHealth` returns `should_fallback + reasons`; when reasons include `bot_challenge` or text patterns matching captcha (recaptcha/cloudflare/etc), emit captcha_detected.
- **error_appeared**: Three sources — (a) error banner text patterns (e.g., "Something went wrong", "Error 500"), (b) console errors (snapshot.console with level=error), (c) JS dialog (alert/confirm/prompt — snapshot.dialog).

Heuristic regex set for error banners (case-insensitive): `/error|failed|something went wrong|try again|invalid|denied/i`. Keep conservative — false positives are noise.

### Tests

8+ tests covering: each emitter type fires when triggered, doesn't fire when not, dedup (don't emit twice for the same text within a snapshot cycle), evidence carries `text` payload.

### TDD

Standard TDD process. Full suite: ~922-925 expected.

```bash
git add orchestrator/src/cognition/event-emitters.ts \
        orchestrator/src/session/session.ts \
        orchestrator/src/engine/page-health.ts \
        orchestrator/tests/cognition/event-emitters.test.ts
git commit -m "feat(cognition): captcha_detected + error_appeared emitters"
```

---

## Task 6 — user_intervention_required (HITL integration)

**Model:** Haiku.

### Files

- Modify: `orchestrator/src/hitl/bus.ts` — accept optional `cognitionBus: CognitionBus`; when a session pauses via ask_human or handoff, emit user_intervention_required
- Modify: `orchestrator/tests/hitl/bus.test.ts` (or appropriate) — extend with cognition emission test

### Implementation

In `HumanIOBus.ask()` and `HumanIOBus.handoff()`, after recording the question/handoff, publish a `user_intervention_required` event with the appropriate `reason`. If cognitionBus is undefined (current behavior preserved), skip publish.

### Tests

2 tests:
- ask() publishes user_intervention_required with reason="ask_human" + question_id
- handoff() publishes with reason="handoff"

### TDD + commit

```bash
git add orchestrator/src/hitl/bus.ts orchestrator/tests/hitl/bus.test.ts
git commit -m "feat(cognition): user_intervention_required emitted from HumanIOBus"
```

---

## Task 7 — SSE endpoint /stream/cognition

**Model:** Sonnet.

### Files

- Create: `orchestrator/src/stream/sse-cognition.ts` — HTTP handler that subscribes to the CognitionBus and writes events as SSE lines
- Modify: `orchestrator/src/http/server.ts` — register the route at `/stream/cognition`
- Create: `orchestrator/tests/stream/sse-cognition.test.ts` — exercise the SSE wire

### Design

The SSE endpoint reads `subscription_id` from query string. The orchestrator's CognitionBus has the subscription already registered (created via JSON-RPC subscribe in T8). The SSE handler:

1. Looks up the subscription on the bus (must exist).
2. Replaces its handler with one that writes SSE lines to the HTTP response: `data: ${JSON.stringify(event)}\n\n`.
3. Keeps the response open until the client disconnects or the subscription is removed.
4. Writes keep-alive comments (`: ping\n\n`) every 30s.

```typescript
// sse-cognition.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CognitionBus } from "../cognition/cognition-bus.js";

export function handleCognitionSse(
  bus: CognitionBus,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const subId = url.searchParams.get("subscription_id");
  if (!subId) { res.writeHead(400).end("missing subscription_id"); return; }

  // Look up subscription — must already be registered by JSON-RPC subscribe call.
  const subs = bus.listSubscriptions();
  const sub = subs.find(s => s.id === subId);
  if (!sub) { res.writeHead(404).end("subscription not found"); return; }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  // Replace the subscription's handler to write to this response stream.
  // (Requires CognitionBus to expose a setHandler(id, fn) method — add it.)
  bus.setHandler(subId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 30000);

  req.on("close", () => {
    clearInterval(keepAlive);
    bus.unsubscribe(subId);
  });
}
```

This requires `CognitionBus.setHandler(id, fn)` — add a simple method that replaces the handler for an existing subscription.

### Tests

Use Node's `http.createServer` + `fetch` (or `http.get` for streaming response). Validate:
- GET /stream/cognition without subscription_id → 400
- GET with bogus subscription_id → 404
- Valid subscription → 200, SSE headers; bus.publish writes a data line; client disconnect cleans up subscription

Streaming tests can use a manual mock — read first 200ms of response, assert the data line appears.

### TDD + commit

```bash
git add orchestrator/src/stream/sse-cognition.ts \
        orchestrator/src/cognition/cognition-bus.ts \
        orchestrator/src/http/server.ts \
        orchestrator/tests/stream/sse-cognition.test.ts
git commit -m "feat(stream): SSE endpoint /stream/cognition + bus.setHandler"
```

---

## Task 8 — JSON-RPC subscribe / unsubscribe methods

**Model:** Sonnet.

### Files

- Modify: `orchestrator/src/http/methods.ts` — add `subscribe(event_type, filter?, debounce_ms?)` and `unsubscribe(subscription_id)`
- Modify orchestrator to share a singleton CognitionBus across HTTP + Session + HITL + Compiler
- Create: `orchestrator/tests/http/subscribe.test.ts` (or extend existing methods test)

### Subscribe response

```json
{
  "subscription_id": "<uuid>",
  "stream_url": "/stream/cognition?subscription_id=<uuid>"
}
```

Agent client uses subscription_id + stream_url to open the SSE connection.

### Singleton bus

The orchestrator factory needs to create one `CognitionBus` at startup and inject it everywhere. Look at how the existing factory wires SiteGraphCache + WatchBus — follow the pattern.

### Tests

3 tests: subscribe with valid event_type → returns subscription_id + URL; unsubscribe removes it; subscribe with invalid event_type → error.

### TDD + commit

```bash
git add orchestrator/src/http/methods.ts orchestrator/src/http/server.ts \
        orchestrator/src/cognition/cognition-bus.ts \
        orchestrator/tests/http/subscribe.test.ts
git commit -m "feat(http): subscribe/unsubscribe JSON-RPC methods + singleton CognitionBus"
```

---

## Task 9 — SDK subscribe API (TS + Py)

**Model:** Sonnet.

### Files

- Modify: `sdk-ts/src/types.ts` — `CognitionEvent` + `EventType` + `EventFilter` mirrors
- Modify: `sdk-ts/src/husk.ts` (or new `sdk-ts/src/subscribe.ts`) — `husk.subscribe(eventType, filter, onEvent)` returning an `{ unsubscribe(): void }` handle. Internally: JSON-RPC call subscribe → EventSource/SSE connection → invoke onEvent on each message → close on unsubscribe.
- Modify: `sdk-py/husk/_types.py` — mirror types
- Modify: `sdk-py/husk/_husk.py` — `async def subscribe(...)` returning an async iterator of events

### TS implementation sketch

```typescript
// sdk-ts/src/subscribe.ts (new)
export interface SubscribeHandle {
  unsubscribe(): Promise<void>;
}

export async function subscribe(
  client: { call: <T = unknown>(method: string, params?: unknown) => Promise<T>; baseUrl: string },
  eventType: EventType,
  filter: EventFilter,
  onEvent: (e: CognitionEvent) => void,
): Promise<SubscribeHandle> {
  const { subscription_id, stream_url } = await client.call("subscribe", {
    event_type: eventType, ...filter,
  });
  const url = new URL(stream_url, client.baseUrl);
  const es = new EventSource(url.toString());
  es.onmessage = (msg) => onEvent(JSON.parse(msg.data));
  return {
    unsubscribe: async () => {
      es.close();
      await client.call("unsubscribe", { subscription_id });
    },
  };
}
```

Add to Husk class: `husk.subscribe(eventType, filter, onEvent)` delegates to this helper.

### Py implementation

Use `httpx-sse` IF it's already in the SDK's deps; otherwise use a manual streaming HTTP read with `httpx.AsyncClient.stream(...)`. Async iterator pattern:

```python
async def subscribe(
    self, event_type: EventType, *, session_id: Optional[str] = None, site: Optional[str] = None,
    debounce_ms: Optional[int] = None,
) -> AsyncIterator[CognitionEvent]:
    resp = await self._client.call("subscribe", {
        "event_type": event_type,
        "session_id": session_id, "site": site, "debounce_ms": debounce_ms,
    })
    subscription_id = resp["subscription_id"]
    stream_url = f"{self._client.base_url}{resp['stream_url']}"
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("GET", stream_url) as r:
            try:
                async for line in r.aiter_lines():
                    if line.startswith("data: "):
                        yield json.loads(line[6:])
            finally:
                await self._client.call("unsubscribe", {"subscription_id": subscription_id})
```

### TDD + commit

Don't add SDK-side unit tests (integration test in T10 covers wire path). Just build the SDKs and verify they compile.

```bash
git add sdk-ts/src/types.ts sdk-ts/src/subscribe.ts sdk-ts/src/husk.ts \
        sdk-py/husk/_types.py sdk-py/husk/_husk.py
git commit -m "feat(sdk): husk.subscribe (TS + Py) with EventSource / httpx streaming"
```

---

## Task 10 — Real-lightpanda integration test

**Model:** Sonnet.

### File

- Create: `orchestrator/tests/integration/cognition-streaming.test.ts`

### Test cases

1. **state_change subscription receives an event after an intention is executed:**
   - Set up real Session against lightpanda fixture
   - Pre-seed cognition states + transitions
   - Subscribe to `state_change` via JSON-RPC `subscribe`
   - Open SSE stream
   - Trigger an intention that navigates to a different page
   - Assert: at least one state_change event is received over SSE within timeout

2. **Unsubscribe stops delivery:**
   - Subscribe + unsubscribe immediately
   - Trigger event-producing action
   - Assert: no events received

3. **Multiple events per subscription:**
   - Subscribe to `state_change`
   - Trigger two transitions
   - Assert: 2 events received

Use `eventsource` npm package (already a peer dep of many things, check sdk-ts deps) or manual HTTP streaming. Pattern-match `tests/integration/cognition-intend.test.ts` for setup.

### TDD + commit

```bash
git add orchestrator/tests/integration/cognition-streaming.test.ts
git commit -m "test(integration): cognition streaming e2e (subscribe → SSE → events)"
```

---

## Task 11 — Spec + memory + tag + merge

**Model:** Haiku.

### Spec amendment

Append Phase E block to Implementation Progress section of `docs/superpowers/specs/2026-05-25-husk-v0.1-design.md`. List shipped: 5 event types, CognitionBus, SSE endpoint, JSON-RPC subscribe/unsubscribe, SDK subscribe API, real-lightpanda e2e. Note explicitly deferred: new_data, rate_limit_*, real-user engine, event replay.

### Memory updates

- `husk-roadmap.md`: `v0.0.21-m22 — Phase E of v0.1 (Streaming Protocol + Subscription Bus)`
- `husk-architecture.md`: append "Cognition Layer — Phase E" subsection
- `husk-overview.md`: status "Phase E of 6 complete"

### Tag + merge

```bash
git tag -a v0.0.21-m22 -m "M22: v0.1 Phase E — Streaming Protocol + Subscription Bus

- 5 event types: state_change, network_idle, error_appeared, captcha_detected, user_intervention_required
- CognitionBus (in-process pub/sub with filter + debounce)
- /stream/cognition SSE endpoint
- JSON-RPC subscribe/unsubscribe methods
- SDK subscribe API (TS + Py)
- Compiler/Session/HumanIOBus emit events naturally
- MCP surface unchanged: 21 tools (husk_subscribe deferred to Phase F)

Phase F (tool surface consolidation, 21→8 tools) is next — final phase of v0.1 build."

git checkout main
git merge --no-ff m22-streaming-bus -m "Merge Milestone 22 (v0.1 Phase E: Streaming + Subscription Bus)"
```

DO NOT push.

---

## Self-review

**Spec coverage:**
- §4.5 subscription bus ✓ (5 event types of 7 mentioned; 2 deferred with documented reasons)
- §7 streaming protocol ✓ (SSE delivery + JSON-RPC registration)
- Engine independence ✓ (events work on any engine; no engine-specific code)

**Tool bloat:** +0 new MCP tools. +2 new JSON-RPC methods (subscribe / unsubscribe). +1 HTTP endpoint (SSE). ✓ for Phase E.

**Backward compat:** All prior milestones work unchanged. CognitionBus is optional in CompilerOptions / Session constructor; when absent, no events emit and existing tests pass identically. ✓

---

## Execution

Subagent-driven, same flow as M18-M21:
- T1 → T11, fresh subagent per task
- Combined spec+code review for T1, T6, T11 (mechanical)
- Separate spec then code review for T2, T7, T8, T9 (substantive)
- Continuous execution; no checkpoints between tasks
- Tag + merge at end; no push.

Branch: `m22-streaming-bus` (already cut from main).
