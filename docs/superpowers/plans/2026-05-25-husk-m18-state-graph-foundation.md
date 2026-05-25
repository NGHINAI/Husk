# Husk M18 — v0.1 Phase A — State Graph Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Context:** v0.1 spec at `docs/superpowers/specs/2026-05-25-husk-v0.1-design.md`. This is **Phase A** of six phases (~6-8 weeks total) to ship v0.1. Phase A lays the foundation: the data model and core machinery for state graphs. No agent-facing changes yet — Phases B-F build on top.

**Goal:** Per-site state graphs (states, transitions, predicates, intentions) live in SQLite. A predicate language evaluates `identify_by` patterns against snapshots. The exploration harness observes sessions and records structural data for later graph synthesis. The confidence engine tracks per-transition reliability. No agent surface changes — this is pure infrastructure.

**Locked decisions from v0.1 spec §16:**
- Fully agent-authored — no seed graphs; ship with empty schema
- LLM-neutral — deterministic predicate evaluator only
- Conservative trust default
- Confidence decay model: 1% / week
- Opt-in community sharing (no registry in this phase)
- v0 tools coexist; not touched in Phase A
- Per-site exploration lock for concurrent agents

**MCP surface change in Phase A:** Zero. No new tools. The cognition layer doesn't surface yet.

**Tech stack:** TypeScript orchestrator. better-sqlite3 (already wired via M4). New module `orchestrator/src/cognition/` houses Phase A code. AGPL.

**Tag at end:** `v0.0.17-m18` (Phase A of v0.1).

---

## Architecture diagram for Phase A

```
┌────────────────────────────────────────────────────┐
│  cognition/                                        │
│  ───────────                                       │
│  state-graph.ts        — YAML+SQLite data model    │
│  predicate.ts          — identify_by evaluator     │
│  exploration.ts        — session observer          │
│  confidence.ts         — success/fail → score      │
│  storage.ts            — SQLite reads/writes       │
│  types.ts              — shared shapes             │
└────────────────────────────────────────────────────┘
                          │
                          ▼
                   M4 site-graph.sqlite (extended)
```

No wiring into Session.snapshot, husk_intend, or anything user-facing in Phase A. Phase B's intention compiler is the first consumer.

---

## File structure

**New:**
- `orchestrator/src/cognition/types.ts` — shared interfaces (StateId, Predicate, Transition, etc.)
- `orchestrator/src/cognition/predicate.ts` — predicate parser + evaluator
- `orchestrator/src/cognition/state-graph.ts` — StateGraph class (in-memory representation)
- `orchestrator/src/cognition/storage.ts` — SQLite reads/writes for state graphs
- `orchestrator/src/cognition/confidence.ts` — confidence math (success/fail → score, decay)
- `orchestrator/src/cognition/exploration.ts` — observe + record observations during a session
- `orchestrator/src/cognition/index.ts` — barrel
- Tests for each (~7 test files)

**Modified:**
- `orchestrator/src/cache/site-graph.ts` (M4) — extend SQLite schema with new tables (additive, no break)
- `orchestrator/src/cache/schema.ts` — bump schema version, add migration

---

## Task map

| # | Task | Model | Est |
|---|---|---|---|
| T1 | Shared types + SQLite schema migration (states, transitions, predicates, observations tables) | Sonnet | 2h |
| T2 | Predicate language: parser + evaluator (url/role/text/network/cookies/forms primitives, AND/OR/NOT) | Sonnet | 3h |
| T3 | StateGraph class — in-memory state machine; load/save to SQLite; BFS path finder | Sonnet | 2.5h |
| T4 | Storage layer — SiteGraphCache extension for state-graph CRUD; per-site exploration lock | Sonnet | 2h |
| T5 | Confidence engine — record_success/record_failure, weekly decay, query reliability | Haiku | 1.5h |
| T6 | Exploration harness — observe a session, extract transitions, record observations | Sonnet | 3h |
| T7 | Integration test: end-to-end exploration of a real lightpanda session on a fixture page | Sonnet | 2h |
| T8 | Spec section + memory updates + tag v0.0.17-m18 + merge --no-ff + push | Haiku | 1h |

**Total:** 8 tasks, ~17h (~2 days). Zero MCP surface change.

---

## Task 1 — Shared types + SQLite schema

### Files

- Create: `orchestrator/src/cognition/types.ts`
- Modify: `orchestrator/src/cache/site-graph.ts` (extend schema)
- Modify: `orchestrator/src/cache/schema.ts` (version bump + migration)
- Test: `orchestrator/tests/cognition/types.test.ts`

### Shared types

```typescript
// orchestrator/src/cognition/types.ts

export type StateId = string;  // "linkedin.com::home_feed"

export interface Predicate {
  type: "url_pattern" | "ax_role_name" | "ax_text_match" | "network_recent" | "cookies_contain" | "forms_present" | "and" | "or" | "not";
  // Discriminated union — see predicate.ts for shapes
  [k: string]: unknown;
}

export interface SiteState {
  site: string;                    // "linkedin.com"
  state_id: StateId;               // "linkedin.com::home_feed"
  identify_by: Predicate;
  affordances: string[];           // names of intentions valid in this state
  observed_count: number;          // how many times this state has been observed
  confidence: number;              // 0..1
  last_seen_at: number;            // ms epoch
}

export interface Transition {
  site: string;
  from_state: StateId;
  to_state: StateId;
  action_sequence: ActionStep[];   // sequence of low-level ops
  success_count: number;
  failure_count: number;
  avg_duration_ms: number;
  confidence: number;
  last_used_at: number;
}

export type ActionStep =
  | { verb: "navigate"; url: string }
  | { verb: "click"; intent: string }
  | { verb: "click_stable_id"; stable_id: string }
  | { verb: "type"; intent: string; text_arg: string }
  | { verb: "press_key"; key: string }
  | { verb: "wait_for"; predicate: Predicate; timeout_ms?: number }
  | { verb: "snapshot" };

export interface Observation {
  site: string;
  ts: number;
  prev_state: StateId | null;
  current_state: StateId;
  url: string;
  snapshot_summary: string;
  action_taken: ActionStep | null;  // what got us here
}
```

### SQLite schema additions

In `orchestrator/src/cache/schema.ts`, bump `SCHEMA_VERSION` (already at 2 from M17 reliability columns) to 3. Add tables:

```sql
-- Per-site states (the AX-fingerprint of a page)
CREATE TABLE IF NOT EXISTS cognition_states (
  site         TEXT NOT NULL,
  state_id     TEXT NOT NULL,
  identify_by  TEXT NOT NULL,           -- JSON-encoded Predicate
  affordances  TEXT NOT NULL,           -- JSON array of intention names
  observed_count INTEGER NOT NULL DEFAULT 0,
  confidence   REAL NOT NULL DEFAULT 0.5,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (site, state_id)
);
CREATE INDEX IF NOT EXISTS idx_cognition_states_site ON cognition_states(site);

-- Per-site transitions (state → action → state)
CREATE TABLE IF NOT EXISTS cognition_transitions (
  site             TEXT NOT NULL,
  from_state       TEXT NOT NULL,
  to_state         TEXT NOT NULL,
  action_sequence  TEXT NOT NULL,       -- JSON ActionStep[]
  success_count    INTEGER NOT NULL DEFAULT 0,
  failure_count    INTEGER NOT NULL DEFAULT 0,
  avg_duration_ms  REAL NOT NULL DEFAULT 0,
  confidence       REAL NOT NULL DEFAULT 0.5,
  last_used_at     INTEGER NOT NULL,
  PRIMARY KEY (site, from_state, to_state)
);
CREATE INDEX IF NOT EXISTS idx_cognition_transitions_site ON cognition_transitions(site);
CREATE INDEX IF NOT EXISTS idx_cognition_transitions_from ON cognition_transitions(site, from_state);

-- Observation log (chronological record of state changes for offline analysis)
CREATE TABLE IF NOT EXISTS cognition_observations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  site         TEXT NOT NULL,
  ts           INTEGER NOT NULL,
  prev_state   TEXT,
  current_state TEXT NOT NULL,
  url          TEXT NOT NULL,
  snapshot_summary TEXT,
  action_taken TEXT                     -- JSON ActionStep | null
);
CREATE INDEX IF NOT EXISTS idx_cognition_observations_site_ts ON cognition_observations(site, ts);

-- Per-site exploration lock (concurrent agent coordination)
CREATE TABLE IF NOT EXISTS cognition_exploration_locks (
  site         TEXT PRIMARY KEY,
  holder_id    TEXT NOT NULL,           -- session_id or agent identifier
  acquired_at  INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL         -- lock auto-expires
);
```

Schema migration: try ALTER TABLE / CREATE TABLE IF NOT EXISTS for each. Wrap in try/catch (existing DBs may already have some columns). Same defensive pattern as M17 T12.

### Test

`orchestrator/tests/cognition/types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { SiteState, Transition, Predicate, ActionStep, Observation } from "../../src/cognition/types.js";

describe("cognition types", () => {
  it("Predicate is a discriminated union usable in switch", () => {
    const p: Predicate = { type: "url_pattern", regex: "/login" };
    if (p.type === "url_pattern") {
      expect(typeof p.regex).toBe("string");
    }
  });

  it("SiteState shape is well-formed", () => {
    const s: SiteState = {
      site: "linkedin.com",
      state_id: "linkedin.com::home_feed",
      identify_by: { type: "url_pattern", regex: "/feed" },
      affordances: ["search", "navigate_profile"],
      observed_count: 5,
      confidence: 0.85,
      last_seen_at: Date.now(),
    };
    expect(s.state_id).toContain("home_feed");
  });

  it("Transition + ActionStep[] shape is well-formed", () => {
    const t: Transition = {
      site: "linkedin.com",
      from_state: "linkedin.com::profile_page",
      to_state: "linkedin.com::connect_modal",
      action_sequence: [
        { verb: "click", intent: "Connect button" } as ActionStep,
        { verb: "wait_for", predicate: { type: "ax_role_name", role: "dialog", name: "Add a note" } } as ActionStep,
      ],
      success_count: 12,
      failure_count: 1,
      avg_duration_ms: 420,
      confidence: 0.92,
      last_used_at: Date.now(),
    };
    expect(t.action_sequence).toHaveLength(2);
  });
});
```

Plus integration test of the SQLite migration:

```typescript
// orchestrator/tests/cache/cognition-schema.test.ts
import { describe, it, expect } from "vitest";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("cognition SQLite schema", () => {
  it("new tables exist after schema migration", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cognition-"));
    const cache = new SiteGraphCache({ cacheDir: dir });
    // Cast to access the internal db handle for verification
    const db = (cache as unknown as { db: { prepare(s: string): { all(): Array<{ name: string }> } } }).db;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    expect(tables).toContain("cognition_states");
    expect(tables).toContain("cognition_transitions");
    expect(tables).toContain("cognition_observations");
    expect(tables).toContain("cognition_exploration_locks");
    cache.close();
  });
});
```

Run, expect FAIL → implement → PASS.

### Commit

```bash
git add orchestrator/src/cognition/types.ts \
        orchestrator/src/cache/site-graph.ts \
        orchestrator/src/cache/schema.ts \
        orchestrator/tests/cognition/types.test.ts \
        orchestrator/tests/cache/cognition-schema.test.ts
git commit -m "feat(cognition): types + SQLite schema for v0.1 state graphs"
```

---

## Task 2 — Predicate language

Pure parser + evaluator. Predicates identify a state from a snapshot. Used heavily in Phases B+ but landing now.

### Files

- Create: `orchestrator/src/cognition/predicate.ts`
- Test: `orchestrator/tests/cognition/predicate.test.ts`

### Predicate vocabulary (locked)

```typescript
export type Predicate =
  | { type: "url_pattern"; regex: string }
  | { type: "ax_role_name"; role: string; name?: string; name_regex?: string }
  | { type: "ax_text_match"; regex: string }
  | { type: "network_recent"; url_pattern: string; method?: string; status?: number }
  | { type: "cookies_contain"; name: string; value_regex?: string }
  | { type: "forms_present"; min_fields?: number; field_types?: string[] }
  | { type: "and"; all: Predicate[] }
  | { type: "or"; any: Predicate[] }
  | { type: "not"; not: Predicate };
```

### Evaluator signature

```typescript
export interface SnapshotForPredicate {
  url: string;
  root: AxNode;
  network?: { recent: Array<{ url: string; method: string; status?: number }> };
  forms?: Array<{ fields: Array<{ type: string }> }>;
  cookies?: Array<{ name: string; value: string }>;
}

export function evaluate(predicate: Predicate, snapshot: SnapshotForPredicate): boolean;
```

Each primitive type has its own evaluator. Compound types (and/or/not) recurse.

### Tests

Cover each primitive + combinators:

```typescript
describe("evaluate predicate", () => {
  const snap = { url: "https://linkedin.com/feed", root: { i: "r", r: "RootWebArea", n: "Feed", c: [
    { i: "h", r: "heading", n: "Feed", c: [] },
    { i: "b", r: "button", n: "Sign out", c: [] },
  ]}, network: { recent: [{ url: "https://linkedin.com/api/me", method: "GET", status: 200 }] } };

  it("url_pattern matches", () => {
    expect(evaluate({ type: "url_pattern", regex: "/feed$" }, snap)).toBe(true);
    expect(evaluate({ type: "url_pattern", regex: "/login$" }, snap)).toBe(false);
  });

  it("ax_role_name with exact name", () => {
    expect(evaluate({ type: "ax_role_name", role: "button", name: "Sign out" }, snap)).toBe(true);
    expect(evaluate({ type: "ax_role_name", role: "button", name: "Login" }, snap)).toBe(false);
  });

  it("ax_role_name with regex name", () => {
    expect(evaluate({ type: "ax_role_name", role: "button", name_regex: "Sign\\s*out" }, snap)).toBe(true);
  });

  it("ax_text_match scans full text", () => {
    expect(evaluate({ type: "ax_text_match", regex: "Feed" }, snap)).toBe(true);
    expect(evaluate({ type: "ax_text_match", regex: "Banana" }, snap)).toBe(false);
  });

  it("network_recent matches url+method+status", () => {
    expect(evaluate({ type: "network_recent", url_pattern: "/api/me", method: "GET", status: 200 }, snap)).toBe(true);
    expect(evaluate({ type: "network_recent", url_pattern: "/api/me", method: "POST" }, snap)).toBe(false);
  });

  it("and: all must match", () => {
    expect(evaluate({ type: "and", all: [
      { type: "url_pattern", regex: "/feed$" },
      { type: "ax_role_name", role: "button", name: "Sign out" },
    ]}, snap)).toBe(true);
    expect(evaluate({ type: "and", all: [
      { type: "url_pattern", regex: "/feed$" },
      { type: "ax_role_name", role: "button", name: "Login" },
    ]}, snap)).toBe(false);
  });

  it("or: any must match", () => {
    expect(evaluate({ type: "or", any: [
      { type: "url_pattern", regex: "/banana" },
      { type: "ax_role_name", role: "button", name: "Sign out" },
    ]}, snap)).toBe(true);
  });

  it("not: inverts", () => {
    expect(evaluate({ type: "not", not: { type: "url_pattern", regex: "/login" } }, snap)).toBe(true);
  });

  it("malformed predicate returns false (don't throw)", () => {
    expect(evaluate({ type: "unknown_kind" } as unknown as Predicate, snap)).toBe(false);
  });
});
```

Comprehensive coverage: 10+ tests.

### Commit

```bash
git add orchestrator/src/cognition/predicate.ts orchestrator/tests/cognition/predicate.test.ts
git commit -m "feat(cognition): predicate language (parser + evaluator)"
```

---

## Task 3 — StateGraph class

In-memory state machine. Loads from SQLite, queries for paths, saves changes.

### Files

- Create: `orchestrator/src/cognition/state-graph.ts`
- Test: `orchestrator/tests/cognition/state-graph.test.ts`

### Class shape

```typescript
export class StateGraph {
  constructor(private site: string, private states: Map<StateId, SiteState>, private transitions: Transition[]) {}

  /** Find which state the current snapshot matches. Returns highest-confidence match. */
  identifyCurrentState(snapshot: SnapshotForPredicate): { state: SiteState; confidence: number } | null;

  /** BFS for an action-sequence path from current to target state. */
  findPath(from: StateId, to: StateId): Transition[] | null;

  /** List affordances available in a state. */
  affordancesIn(state_id: StateId): string[];

  /** Add or update a state. */
  upsertState(s: SiteState): void;

  /** Add or update a transition. */
  upsertTransition(t: Transition): void;

  /** Serialize to JSON for storage. */
  toJSON(): { site: string; states: SiteState[]; transitions: Transition[] };

  /** Hydrate from storage. */
  static fromJSON(data: ReturnType<StateGraph["toJSON"]>): StateGraph;
}
```

### Tests

```typescript
describe("StateGraph", () => {
  const sg = new StateGraph("linkedin.com", new Map(), []);
  sg.upsertState({ site: "linkedin.com", state_id: "linkedin.com::login_form", identify_by: { type: "url_pattern", regex: "/login" }, affordances: ["submit_login"], observed_count: 1, confidence: 0.5, last_seen_at: Date.now() });
  sg.upsertState({ site: "linkedin.com", state_id: "linkedin.com::home_feed", identify_by: { type: "url_pattern", regex: "/feed" }, affordances: ["search"], observed_count: 1, confidence: 0.5, last_seen_at: Date.now() });
  sg.upsertTransition({ site: "linkedin.com", from_state: "linkedin.com::login_form", to_state: "linkedin.com::home_feed", action_sequence: [{ verb: "click", intent: "Sign in" }], success_count: 1, failure_count: 0, avg_duration_ms: 500, confidence: 0.85, last_used_at: Date.now() });

  it("identifies current state from snapshot", () => {
    const m = sg.identifyCurrentState({ url: "https://linkedin.com/feed", root: { i: "r", r: "RootWebArea", n: "", c: [] } });
    expect(m?.state.state_id).toBe("linkedin.com::home_feed");
  });

  it("findPath returns action sequence between states", () => {
    const path = sg.findPath("linkedin.com::login_form", "linkedin.com::home_feed");
    expect(path).toHaveLength(1);
    expect(path?.[0].action_sequence[0].verb).toBe("click");
  });

  it("findPath returns null when no route exists", () => {
    expect(sg.findPath("linkedin.com::nonexistent", "linkedin.com::home_feed")).toBeNull();
  });

  it("affordancesIn returns affordance list for a state", () => {
    expect(sg.affordancesIn("linkedin.com::home_feed")).toEqual(["search"]);
  });

  it("toJSON / fromJSON roundtrip preserves structure", () => {
    const json = sg.toJSON();
    const restored = StateGraph.fromJSON(json);
    expect(restored.findPath("linkedin.com::login_form", "linkedin.com::home_feed")).toHaveLength(1);
  });
});
```

### Commit

```bash
git add orchestrator/src/cognition/state-graph.ts orchestrator/tests/cognition/state-graph.test.ts
git commit -m "feat(cognition): StateGraph class (in-memory state machine + BFS)"
```

---

## Task 4 — Storage layer

SiteGraphCache extension for state-graph CRUD. Per-site exploration lock.

### Files

- Create: `orchestrator/src/cognition/storage.ts`
- Test: `orchestrator/tests/cognition/storage.test.ts`

### API

```typescript
export class CognitionStorage {
  constructor(private cache: SiteGraphCache) {}

  // States
  upsertState(s: SiteState): void;
  getState(site: string, state_id: StateId): SiteState | null;
  listStates(site: string): SiteState[];

  // Transitions
  upsertTransition(t: Transition): void;
  getTransitions(site: string, from?: StateId): Transition[];

  // Observations (append-only log)
  recordObservation(o: Observation): void;
  recentObservations(site: string, since_ts: number): Observation[];

  // Load full state graph for a site
  loadStateGraph(site: string): StateGraph;

  // Exploration lock (per-site)
  acquireExplorationLock(site: string, holder_id: string, ttl_ms?: number): boolean;
  releaseExplorationLock(site: string, holder_id: string): void;
  isExplorationLocked(site: string): { holder_id: string; expires_at: number } | null;
}
```

### Tests

```typescript
describe("CognitionStorage", () => {
  let cache: SiteGraphCache;
  let storage: CognitionStorage;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cog-"));
    cache = new SiteGraphCache({ cacheDir: dir });
    storage = new CognitionStorage(cache);
  });
  afterEach(() => cache.close());

  it("upsert + load + list states roundtrip", () => {
    storage.upsertState({ site: "linkedin.com", state_id: "x::y", identify_by: { type: "url_pattern", regex: "/foo" }, affordances: ["a"], observed_count: 1, confidence: 0.5, last_seen_at: Date.now() });
    expect(storage.getState("linkedin.com", "x::y")?.affordances).toEqual(["a"]);
    expect(storage.listStates("linkedin.com")).toHaveLength(1);
  });

  it("upsert + getTransitions returns transitions matching from filter", () => {
    storage.upsertTransition({ site: "x", from_state: "a", to_state: "b", action_sequence: [], success_count: 0, failure_count: 0, avg_duration_ms: 0, confidence: 0.5, last_used_at: Date.now() });
    storage.upsertTransition({ site: "x", from_state: "a", to_state: "c", action_sequence: [], success_count: 0, failure_count: 0, avg_duration_ms: 0, confidence: 0.5, last_used_at: Date.now() });
    storage.upsertTransition({ site: "x", from_state: "b", to_state: "c", action_sequence: [], success_count: 0, failure_count: 0, avg_duration_ms: 0, confidence: 0.5, last_used_at: Date.now() });
    expect(storage.getTransitions("x")).toHaveLength(3);
    expect(storage.getTransitions("x", "a")).toHaveLength(2);
  });

  it("recordObservation + recentObservations returns chronologically", () => {
    const t = Date.now();
    storage.recordObservation({ site: "x", ts: t - 1000, prev_state: null, current_state: "a", url: "/", snapshot_summary: "init", action_taken: null });
    storage.recordObservation({ site: "x", ts: t,        prev_state: "a",  current_state: "b", url: "/x", snapshot_summary: "moved", action_taken: { verb: "navigate", url: "/x" } });
    const obs = storage.recentObservations("x", t - 2000);
    expect(obs).toHaveLength(2);
    expect(obs[1].current_state).toBe("b");
  });

  it("loadStateGraph constructs an in-memory StateGraph", () => {
    storage.upsertState({ site: "x", state_id: "x::a", identify_by: { type: "url_pattern", regex: "/a" }, affordances: [], observed_count: 1, confidence: 0.5, last_seen_at: Date.now() });
    const g = storage.loadStateGraph("x");
    expect(g.affordancesIn("x::a")).toEqual([]);
  });

  it("acquireExplorationLock — first agent wins, second is blocked", () => {
    expect(storage.acquireExplorationLock("linkedin.com", "agent_a")).toBe(true);
    expect(storage.acquireExplorationLock("linkedin.com", "agent_b")).toBe(false);
    expect(storage.isExplorationLocked("linkedin.com")?.holder_id).toBe("agent_a");
  });

  it("releaseExplorationLock — allows next agent to acquire", () => {
    storage.acquireExplorationLock("x", "a");
    storage.releaseExplorationLock("x", "a");
    expect(storage.acquireExplorationLock("x", "b")).toBe(true);
  });

  it("lock expires after TTL", async () => {
    storage.acquireExplorationLock("x", "a", 50);  // 50ms TTL
    await new Promise((r) => setTimeout(r, 100));
    expect(storage.acquireExplorationLock("x", "b")).toBe(true);  // lock should have expired
  });
});
```

### Commit

```bash
git add orchestrator/src/cognition/storage.ts orchestrator/tests/cognition/storage.test.ts
git commit -m "feat(cognition): CognitionStorage (SQLite CRUD + exploration lock)"
```

---

## Task 5 — Confidence engine

### Files

- Create: `orchestrator/src/cognition/confidence.ts`
- Test: `orchestrator/tests/cognition/confidence.test.ts`

### Math (locked)

- New transition: confidence = 0.5
- On success: `confidence = min(0.99, confidence + 0.05)`
- On failure: `confidence = max(0.05, confidence - 0.10)`
- Weekly decay: `confidence -= 0.01 * weeks_since_last_use` (floored at 0.05)
- Reliability score for ranking: `success_count / (success_count + failure_count + 2)` (smoothed Laplace prior)

### API

```typescript
export function newTransitionConfidence(): number;
export function applySuccess(current: number): number;
export function applyFailure(current: number): number;
export function decay(current: number, last_used_at: number, now_at: number): number;
export function reliability(t: { success_count: number; failure_count: number }): number;
```

### Tests

Straightforward: each function tested with edge cases (floor, cap, decay over time).

### Commit

```bash
git add orchestrator/src/cognition/confidence.ts orchestrator/tests/cognition/confidence.test.ts
git commit -m "feat(cognition): confidence engine (success/failure + weekly decay)"
```

---

## Task 6 — Exploration harness

Observes a session: every snapshot taken, every action result, every state change. Records to the observations log and updates state/transition state.

### Files

- Create: `orchestrator/src/cognition/exploration.ts`
- Test: `orchestrator/tests/cognition/exploration.test.ts`

### Design

`ExplorationHarness` wraps a Session-like object. After each action + post-snapshot, it:

1. Identifies the current state via predicates over the current snapshot
2. If the state is new (no predicate matches), generates a tentative new state with a heuristic predicate (URL pattern + a few AX markers) and writes it
3. If the state is known, increments observed_count + last_seen_at
4. If there was a previous state + action taken, upserts a transition; success_count++ if action succeeded
5. Appends an Observation row

### API

```typescript
export interface ExplorationOptions {
  site: string;
  session_id: string;
  storage: CognitionStorage;
}

export class ExplorationHarness {
  constructor(opts: ExplorationOptions);

  /** Called after every navigation, action, etc. The snapshot is the result of the action. */
  observe(snapshot: SnapshotForPredicate, lastAction?: ActionStep): void;

  /** When done with a session — flush any in-flight tracking. */
  finish(): void;
}
```

### Heuristic for inferring states from snapshots (when nothing matches yet)

Generate a tentative state with `identify_by`:

```typescript
{
  type: "and",
  all: [
    { type: "url_pattern", regex: escapeRegex(normalizeUrl(snapshot.url)) },
    // optionally: one or two most distinctive AX markers (e.g., a unique heading or button)
    ...mostDistinctiveAxNodes(snapshot.root, 2).map(n => ({
      type: "ax_role_name", role: n.r, name: n.n
    })),
  ],
}
```

`mostDistinctiveAxNodes` heuristic: pick nodes with unique-on-this-site names (headings + primary buttons rank highest). This is approximate; refined over many observations in subsequent phases.

### Tests

Mock storage; feed sequence of snapshots; verify states and transitions accumulate.

```typescript
describe("ExplorationHarness", () => {
  it("first observation creates a new state", async () => {
    const storage = new InMemoryStorage();  // test double
    const harness = new ExplorationHarness({ site: "linkedin.com", session_id: "s1", storage });
    harness.observe({ url: "https://linkedin.com/login", root: ... });
    const states = storage.listStates("linkedin.com");
    expect(states).toHaveLength(1);
    expect(states[0].observed_count).toBe(1);
  });

  it("re-observation of same state increments observed_count", () => {
    const storage = new InMemoryStorage();
    const harness = new ExplorationHarness({ site: "linkedin.com", session_id: "s1", storage });
    harness.observe({ url: "https://linkedin.com/login", root: ... });
    harness.observe({ url: "https://linkedin.com/login", root: ... });
    expect(storage.listStates("linkedin.com")[0].observed_count).toBe(2);
  });

  it("observation after an action records a transition", () => {
    const storage = new InMemoryStorage();
    const harness = new ExplorationHarness({ site: "linkedin.com", session_id: "s1", storage });
    harness.observe({ url: "https://linkedin.com/login", root: ... });
    harness.observe({ url: "https://linkedin.com/feed", root: ... }, { verb: "click", intent: "Sign in" });
    const tr = storage.getTransitions("linkedin.com");
    expect(tr).toHaveLength(1);
    expect(tr[0].action_sequence[0]).toEqual({ verb: "click", intent: "Sign in" });
  });

  it("appends observations to the log", () => {
    const storage = new InMemoryStorage();
    const harness = new ExplorationHarness({ site: "linkedin.com", session_id: "s1", storage });
    harness.observe({ url: "https://linkedin.com/login", root: ... });
    expect(storage.recentObservations("linkedin.com", 0)).toHaveLength(1);
  });
});
```

### Commit

```bash
git add orchestrator/src/cognition/exploration.ts orchestrator/tests/cognition/exploration.test.ts
git commit -m "feat(cognition): exploration harness (observe + record states/transitions)"
```

---

## Task 7 — Integration test against lightpanda

Wire the exploration harness into a real lightpanda session, drive a few navigations, verify states/transitions accumulate in SQLite.

### Files

- Create: `orchestrator/tests/integration/cognition-exploration.test.ts`

This test only runs with `HUSK_INT=1 LIGHTPANDA_BIN=<path>`. Uses a fixture HTTP server (existing pattern from M13/M16) with a tiny multi-page app (`/login` → submit form → `/dashboard`).

```typescript
describe("cognition exploration e2e (lightpanda)", () => {
  let fixture: ...;
  let orchestrator: ...;
  let storage: CognitionStorage;

  beforeAll(...);
  afterAll(...);

  it("drives login flow; harness records 2 states + 1 transition", async () => {
    const session = await orchestrator.createSession();
    const harness = new ExplorationHarness({ site: "fixture.local", session_id: session.id, storage });

    await session.goto({ url: `http://localhost:${fixture.port}/login` });
    harness.observe(await session.snapshot());

    await session.click({ intent: "Sign in" });
    harness.observe(await session.snapshot(), { verb: "click", intent: "Sign in" });

    const states = storage.listStates("fixture.local");
    expect(states.length).toBe(2);
    const transitions = storage.getTransitions("fixture.local");
    expect(transitions.length).toBe(1);
  }, 60_000);
});
```

### Commit

```bash
git add orchestrator/tests/integration/cognition-exploration.test.ts
git commit -m "test(integration): cognition exploration e2e against lightpanda"
```

---

## Task 8 — Docs + tag + merge + push

### Spec amendment

Append to `docs/superpowers/specs/2026-05-25-husk-v0.1-design.md`:

```markdown
## Implementation Progress

### Phase A — State Graph Foundation (M18 — shipped 2026-05-25)

Shipped:
- SQLite schema for cognition_states, cognition_transitions, cognition_observations, cognition_exploration_locks
- Predicate language (url_pattern, ax_role_name, ax_text_match, network_recent, cookies_contain, forms_present, and/or/not) + evaluator
- StateGraph class (in-memory state machine + BFS path finder)
- CognitionStorage (SQLite CRUD + per-site exploration lock)
- Confidence engine (success/failure + weekly decay + reliability ranking)
- ExplorationHarness (observe snapshots + auto-create states + auto-record transitions)
- Integration test against lightpanda

Not yet shipped (Phase B+):
- Intention compiler — Phase B
- Outcome verifier + failure taxonomy — Phase C
- Capability router rewrite — Phase D
- Streaming protocol — Phase E
- Tool surface consolidation — Phase F

**MCP surface unchanged at 21 tools.** Cognition layer is pure infrastructure; no agent-facing changes in Phase A.

**Test count after Phase A:** [fill in]
```

### Memory updates

- `husk-roadmap.md`: add `v0.0.17-m18 — Phase A of v0.1 (State Graph Foundation)`
- `husk-architecture.md`: append "Cognition Layer (M18)" subsection summarizing the new module and locked decisions
- `husk-overview.md`: status update — `v0.1 build in progress, Phase A of 6 complete`

### Tag + merge

```bash
git tag -a v0.0.17-m18 -m "M18: v0.1 Phase A — State Graph Foundation

- Cognition layer: types, predicate evaluator, StateGraph class, storage, confidence, exploration harness
- SQLite schema (cognition_states, cognition_transitions, cognition_observations, cognition_exploration_locks)
- Locked decisions from v0.1 spec §16: agent-authored only, LLM-neutral, conservative trust, confidence decay
- MCP surface unchanged: 21 tools (cognition layer is pure infrastructure in Phase A)

Phase B (intention compiler) is next."

git checkout main
git merge --no-ff m18-state-graph-foundation -m "Merge Milestone 18 (v0.1 Phase A: State Graph Foundation)"
git push origin main
git push origin v0.0.17-m18
```

(Push will still be blocked by GH email privacy; document and continue.)

---

## Self-review

**Spec coverage:** All 6 Phase A capabilities from v0.1 spec §15-A covered across T1-T6. T7 integration validates the chain. T8 ships docs + tag. ✓

**Tool bloat:** **+0 new MCP tools.** This is pure infrastructure; no agent surface changes. ✓

**Locked decisions honored:**
- Agent-authored only — no seed graphs ✓
- LLM-neutral — predicate evaluator is regex/role/network/cookies only ✓
- Confidence decay model 1% / week ✓
- Per-site exploration lock for concurrent agents ✓

**Backward compat:** No changes to existing M4 SiteGraphCache API. SQLite schema migration is additive (new tables, no column changes on existing ones). ✓

**Engine independence:** Cognition layer works with any engine (lightpanda or chrome) because it operates on snapshots, not raw CDP. ✓

---

## Execution

Subagent-driven, same flow as M14-M17:
- T1 → review → T2 → review → ... → T8
- One subagent per task, two-stage review (spec compliance + code quality)
- Continuous execution; no checkpoints between tasks
- Tag + merge at end

Branch: `m18-state-graph-foundation` (to cut from main after plan commit).
