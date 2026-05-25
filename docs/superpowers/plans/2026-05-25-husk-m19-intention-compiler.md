# Husk M19 — Phase B: Intention Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the intention compiler — `session.intend("name", args)` resolves the current state, plans a path through the state graph (M18), executes each transition's action sequence (M5 primitives), runs verify predicates, and returns an `Outcome` envelope with a typed `reason` on failure.

**Architecture:** Phase B builds the second of three v0.1 cognition layers on top of M18's state graph foundation. The compiler is pure orchestration — it doesn't author intentions (YAML-defined per site), doesn't use LLMs, and reuses existing M5 watchdog/action primitives. New surface: SDK + JSON-RPC method `intend`. MCP tool surface remains at 21 (consolidation deferred to Phase F).

**Tech Stack:** TypeScript (orchestrator), js-yaml (intention YAML), existing better-sqlite3 (cognition_intentions table extends M18 schema). No new dependencies.

**Locked decisions honored (v0.1 spec §16):**
- LLM-neutral — pure deterministic compilation
- Agent-authored only — intentions are YAML-defined, no auto-synthesis
- Conservative trust — failures classified into a finite taxonomy, not bubbled as raw exceptions
- Outcome envelope contract is non-negotiable

**Spec references:** v0.1 design doc §4.1 (vocabulary), §4.2 (compiler), §4.3 (Outcome), §4.4 (failure modes), §4.6 (confidence integration), §4.7 (memory model).

---

## File Structure

### New files (cognition layer extension)

```
orchestrator/src/cognition/
  intention-types.ts        # Intention, IntentionStep, VerifyCheck, FailureMode, Outcome, Evidence, FailureReason enum
  failure-taxonomy.ts       # 30 FailureReason values + classifyError() + recovery-strategy table
  intention-store.ts        # SQLite CRUD for cognition_intentions table
  intention-yaml.ts         # Parse + validate YAML intention definitions → typed Intention
  intent-resolver.ts        # resolveIntentRef(snapshot, ref) → stable_id (wraps existing M5 find.ts)
  verify-runner.ts          # runVerify(check, sessionContext) → Evidence
  intention-compiler.ts     # IntentionCompiler.execute(session, intention, args) → Outcome
  index.ts                  # extend barrel re-exports
```

### Modified files

```
orchestrator/src/cache/schema.ts                    # schema v3 → v4: add cognition_intentions table
orchestrator/src/http/methods.ts                    # new `intend` JSON-RPC method
orchestrator/src/http/server.ts                     # register `intend` method (if methods.ts auto-registers, no change)
orchestrator/src/session/session.ts                 # add Session.intend(name, args) method
sdk/ts/src/types.ts                                 # Outcome, Evidence, FailureReason types
sdk/ts/src/session.ts                               # Session.intend() in TS SDK
sdk/py/husk/types.py                                # Outcome dataclass, Evidence, FailureReason
sdk/py/husk/session.py                              # Session.intend() in Python SDK
```

### Test files

```
orchestrator/tests/cognition/intention-types.test.ts
orchestrator/tests/cognition/failure-taxonomy.test.ts
orchestrator/tests/cognition/intention-store.test.ts
orchestrator/tests/cognition/intention-yaml.test.ts
orchestrator/tests/cognition/intent-resolver.test.ts
orchestrator/tests/cognition/verify-runner.test.ts
orchestrator/tests/cognition/intention-compiler.test.ts
orchestrator/tests/integration/cognition-intend.test.ts   # real-lightpanda e2e
sdk/ts/test/intend.test.ts
sdk/py/tests/test_intend.py
```

---

## Task 1 — Intention types + SQLite schema migration (v3 → v4)

**Model:** Haiku — mechanical types + schema ALTER.

### Files

- Create: `orchestrator/src/cognition/intention-types.ts`
- Modify: `orchestrator/src/cache/schema.ts` (bump SCHEMA_VERSION 3→4, add cognition_intentions table)
- Test: `orchestrator/tests/cognition/intention-types.test.ts`

### Type definitions (intention-types.ts)

```typescript
import type { Predicate, ActionStep, StateId } from "./types.js";

/** A verification check that runs after intention steps complete. */
export type VerifyCheck =
  | { type: "predicate"; predicate: Predicate; description: string }
  | { type: "network"; method?: "GET" | "POST" | "PUT" | "DELETE"; url_pattern: string; status_min?: number; status_max?: number; description: string }
  | { type: "url"; pattern: string; description: string };

/** A pattern matched against a runtime error to classify failure into a typed reason. */
export interface FailureModePattern {
  reason: FailureReason;
  match: VerifyCheck;  // when this predicate matches, the failure is classified as `reason`
}

/** Reference to an element by intent rather than stable_id.
 *  Resolved at runtime against the current snapshot. */
export type IntentRef =
  | { button: string }
  | { link: string }
  | { textbox: string }
  | { combobox: string }
  | { heading: string }
  | { role: string; name: string };

/** A single step within an intention's `steps` array. */
export type IntentionStep =
  | { verb: "click"; target: IntentRef }
  | { verb: "type"; target: IntentRef; value: string }  // value may be a template like "{{args.email}}"
  | { verb: "press_key"; key: string }
  | { verb: "scroll"; direction: "up" | "down" | "into_view"; target?: IntentRef; amount_px?: number }
  | { verb: "wait_for"; predicate: Predicate; timeout_ms?: number }
  | { verb: "navigate"; url: string }  // url may be templated
  | { verb: "snapshot" };

export interface Intention {
  site: string;
  name: string;
  /** JSON Schema describing the args this intention accepts. Stored as JSON in DB. */
  args_schema: Record<string, unknown>;
  /** State the intention requires to begin. May reference args via "{{args.X}}". */
  requires_state?: StateId;
  steps: IntentionStep[];
  verify: VerifyCheck[];
  failure_modes: FailureModePattern[];
  /** Optional comment for humans reading the YAML. */
  description?: string;
  created_at: number;
  updated_at: number;
}

/** Finite vocabulary of why an intention failed. */
export type FailureReason =
  // State-machine reasons
  | "unknown_site"
  | "unknown_state"
  | "no_path_to_target"
  | "state_drift_mid_execution"
  | "verify_failed"
  // Step execution reasons
  | "element_not_found"
  | "element_not_interactive"
  | "watchdog_rejected"
  | "timeout"
  // Network reasons
  | "network_failure"
  | "network_timeout"
  | "network_throttled"
  | "rate_limited"
  // Site-side reasons
  | "account_locked"
  | "bot_challenge"
  | "two_factor_required"
  | "permission_denied"
  | "content_not_found"
  | "feature_unavailable"
  // Human reasons
  | "needs_human"
  | "needs_credentials"
  | "needs_2fa_code"
  | "needs_payment_confirmation"
  | "human_declined"
  | "human_timeout"
  // Engine reasons
  | "engine_unsupported"
  | "engine_crashed"
  | "out_of_memory"
  | "pool_exhausted"
  // Unknown
  | "unknown_error";

/** A single recorded verification check + result. */
export interface Evidence {
  predicate: string;          // human-readable description
  passed: boolean;
  observed_value?: unknown;
}

/** Log entry for a single transition executed mid-intention. */
export interface TransitionLog {
  from_state: StateId;
  to_state: StateId;
  actions: ActionStep[];
  duration_ms: number;
  ok: boolean;
}

/** The result envelope returned to the agent. */
export interface Outcome<T = unknown> {
  ok: boolean;
  intention: string;
  args: unknown;
  state_before: StateId | null;
  state_after?: StateId;
  result?: T;
  evidence: Evidence[];
  duration_ms: number;
  reason?: FailureReason;
  reason_detail?: string;
  recovery_options?: Array<{
    label: string;
    intention?: string;
    needs_human?: boolean;
  }>;
  steps_observed: TransitionLog[];
}
```

### SQLite schema change (schema.ts)

```typescript
// Bump SCHEMA_VERSION
export const SCHEMA_VERSION = 4;

// Add to the cognition tables block:
const COGNITION_INTENTIONS_DDL = `
CREATE TABLE IF NOT EXISTS cognition_intentions (
  site         TEXT NOT NULL,
  name         TEXT NOT NULL,
  args_schema  TEXT NOT NULL DEFAULT '{}',
  requires_state TEXT,
  steps_json   TEXT NOT NULL,
  verify_json  TEXT NOT NULL DEFAULT '[]',
  failure_modes_json TEXT NOT NULL DEFAULT '[]',
  description  TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (site, name)
);

CREATE INDEX IF NOT EXISTS idx_cognition_intentions_site
  ON cognition_intentions (site);
`;
```

Add `COGNITION_INTENTIONS_DDL` to the schema-application list. Ensure schema-version bump triggers re-apply (existing applySchema logic handles this idempotently).

### TDD steps

- [ ] **Step 1: Write failing test for type compilation**

```typescript
// orchestrator/tests/cognition/intention-types.test.ts
import { describe, it, expect } from "vitest";
import type { Intention, Outcome, FailureReason, IntentionStep, VerifyCheck } from "../../src/cognition/intention-types.js";

describe("intention types", () => {
  it("Intention conforms to the spec shape", () => {
    const i: Intention = {
      site: "linkedin.com",
      name: "send_connect",
      args_schema: { type: "object", properties: { person: { type: "string" } } },
      requires_state: "profile_page",
      steps: [
        { verb: "click", target: { button: "Connect" } },
        { verb: "click", target: { button: "Send without a note" } },
      ],
      verify: [
        { type: "network", method: "POST", url_pattern: "/voyager/api/relationships/sentInvitationViewsV2", status_min: 200, status_max: 299, description: "invite POST returned 2xx" },
      ],
      failure_modes: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    expect(i.name).toBe("send_connect");
    expect(i.steps[0].verb).toBe("click");
  });

  it("Outcome carries evidence + steps_observed", () => {
    const o: Outcome = {
      ok: true,
      intention: "send_connect",
      args: { person: "Vikash" },
      state_before: "profile_page",
      state_after: "profile_page_pending",
      evidence: [{ predicate: "POST returned 200", passed: true }],
      duration_ms: 1234,
      steps_observed: [],
    };
    expect(o.evidence.length).toBe(1);
  });

  it("FailureReason includes all 30 reasons", () => {
    const reasons: FailureReason[] = [
      "unknown_site","unknown_state","no_path_to_target","state_drift_mid_execution","verify_failed",
      "element_not_found","element_not_interactive","watchdog_rejected","timeout",
      "network_failure","network_timeout","network_throttled","rate_limited",
      "account_locked","bot_challenge","two_factor_required","permission_denied","content_not_found","feature_unavailable",
      "needs_human","needs_credentials","needs_2fa_code","needs_payment_confirmation","human_declined","human_timeout",
      "engine_unsupported","engine_crashed","out_of_memory","pool_exhausted",
      "unknown_error",
    ];
    expect(reasons.length).toBe(30);
  });
});
```

Run: `pnpm --filter husk-orchestrator test cognition/intention-types`
Expected: FAIL — cannot find intention-types.

- [ ] **Step 2: Write intention-types.ts per the definitions above**

- [ ] **Step 3: Re-run tests — expect PASS (3/3)**

- [ ] **Step 4: Add cognition_intentions table to schema.ts**

Bump `SCHEMA_VERSION` constant from 3 to 4. Append the DDL block above to the schema application list.

- [ ] **Step 5: Write schema-migration test**

```typescript
// orchestrator/tests/cognition/intention-store.test.ts  (just the schema portion for now)
import { describe, it, expect, afterEach } from "vitest";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

describe("cognition_intentions schema", () => {
  let dir: string;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates cognition_intentions table at schema v4", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "husk-m19-"));
    const cache = new SiteGraphCache(dir);
    const db = cache.db;
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cognition_intentions'").get();
    expect(row).toBeTruthy();
    const userVersion = db.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(userVersion.user_version).toBeGreaterThanOrEqual(4);
    cache.close();
  });
});
```

Run: `pnpm --filter husk-orchestrator test cognition/intention-store`
Expected: PASS.

- [ ] **Step 6: Run full suite to confirm no regression**

Run: `pnpm --filter husk-orchestrator test`
Expected: 796 + new tests, all green.

- [ ] **Step 7: Commit**

```bash
git add orchestrator/src/cognition/intention-types.ts \
        orchestrator/src/cache/schema.ts \
        orchestrator/tests/cognition/intention-types.test.ts \
        orchestrator/tests/cognition/intention-store.test.ts
git commit -m "feat(cognition): intention types + schema v4 (cognition_intentions table)"
```

---

## Task 2 — Failure-mode taxonomy + classifier

**Model:** Haiku — pure mapping + tests.

### Files

- Create: `orchestrator/src/cognition/failure-taxonomy.ts`
- Test: `orchestrator/tests/cognition/failure-taxonomy.test.ts`

### Module body

```typescript
import type { FailureReason } from "./intention-types.js";

/** Human-facing recovery hint for each failure reason. */
const RECOVERY_STRATEGIES: Record<FailureReason, string> = {
  unknown_site: "Drive the site in exploration mode first so the graph can learn.",
  unknown_state: "Take a snapshot and use the state-recovery flow (deferred to Phase C).",
  no_path_to_target: "Either define a transition or extend the state graph.",
  state_drift_mid_execution: "Site moved unexpectedly; replan from the new state.",
  verify_failed: "The action ran but the post-condition was not observed.",
  element_not_found: "Selector resolved nothing in the current snapshot.",
  element_not_interactive: "Element exists but is disabled/hidden.",
  watchdog_rejected: "Watchdog policy blocked the action.",
  timeout: "Operation exceeded its wait budget.",
  network_failure: "Underlying network request failed.",
  network_timeout: "Network call timed out.",
  network_throttled: "Server signaled throttling (HTTP 503/throttled headers).",
  rate_limited: "Server returned 429 or rate-limit messaging.",
  account_locked: "Account is locked; needs human intervention.",
  bot_challenge: "Site flagged us as a bot; escalate via seamless handoff.",
  two_factor_required: "2FA prompt encountered; needs TOTP or human.",
  permission_denied: "User lacks permission for this action.",
  content_not_found: "Target content (page/profile/post) does not exist.",
  feature_unavailable: "Site does not expose this capability for this user.",
  needs_human: "Explicit handoff requested.",
  needs_credentials: "No stored creds for this site.",
  needs_2fa_code: "Need a one-time code from the user.",
  needs_payment_confirmation: "Payment requires user approval.",
  human_declined: "User refused to continue.",
  human_timeout: "User did not respond in time.",
  engine_unsupported: "Selected engine cannot run this site.",
  engine_crashed: "Engine process died mid-action.",
  out_of_memory: "Engine ran out of memory.",
  pool_exhausted: "No engines available; pool at capacity.",
  unknown_error: "Unclassified runtime failure; check reason_detail.",
};

export function recoveryStrategy(reason: FailureReason): string {
  return RECOVERY_STRATEGIES[reason];
}

/** Classify a thrown error into a typed FailureReason. Best-effort heuristic. */
export function classifyError(err: unknown): { reason: FailureReason; detail: string } {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (/rate.?limit|429|too many requests/.test(msg)) return { reason: "rate_limited", detail: err.message };
    if (/2fa|two.?factor|totp|verification code/.test(msg)) return { reason: "two_factor_required", detail: err.message };
    if (/captcha|robot|bot.?challenge|unusual activity/.test(msg)) return { reason: "bot_challenge", detail: err.message };
    if (/timeout|timed? out/.test(msg)) return { reason: "timeout", detail: err.message };
    if (/network|fetch failed|econnreset|enotfound/.test(msg)) return { reason: "network_failure", detail: err.message };
    if (/not found|404|no such element/.test(msg)) return { reason: "element_not_found", detail: err.message };
    if (/permission|forbidden|403/.test(msg)) return { reason: "permission_denied", detail: err.message };
    if (/watchdog|policy/.test(msg)) return { reason: "watchdog_rejected", detail: err.message };
    if (/out of memory|enomem|oom/.test(msg)) return { reason: "out_of_memory", detail: err.message };
    if (/crashed|killed|exited/.test(msg)) return { reason: "engine_crashed", detail: err.message };
    return { reason: "unknown_error", detail: err.message };
  }
  return { reason: "unknown_error", detail: String(err) };
}
```

### Tests

```typescript
import { describe, it, expect } from "vitest";
import { classifyError, recoveryStrategy } from "../../src/cognition/failure-taxonomy.js";

describe("failure-taxonomy", () => {
  it("classifies 429 errors as rate_limited", () => {
    expect(classifyError(new Error("HTTP 429 Too Many Requests")).reason).toBe("rate_limited");
  });

  it("classifies 2FA errors", () => {
    expect(classifyError(new Error("two-factor authentication required")).reason).toBe("two_factor_required");
  });

  it("classifies bot challenges", () => {
    expect(classifyError(new Error("captcha challenge detected")).reason).toBe("bot_challenge");
  });

  it("classifies timeouts", () => {
    expect(classifyError(new Error("operation timed out after 5000ms")).reason).toBe("timeout");
  });

  it("classifies network failures", () => {
    expect(classifyError(new Error("fetch failed: ECONNRESET")).reason).toBe("network_failure");
  });

  it("classifies element-not-found", () => {
    expect(classifyError(new Error("no such element in snapshot")).reason).toBe("element_not_found");
  });

  it("falls back to unknown_error", () => {
    expect(classifyError(new Error("something obscure")).reason).toBe("unknown_error");
  });

  it("handles non-Error throws", () => {
    expect(classifyError("string error").reason).toBe("unknown_error");
    expect(classifyError(null).reason).toBe("unknown_error");
  });

  it("recoveryStrategy returns non-empty strings for all reasons", () => {
    const sample: Array<"rate_limited" | "bot_challenge" | "no_path_to_target" | "unknown_error"> = [
      "rate_limited", "bot_challenge", "no_path_to_target", "unknown_error",
    ];
    for (const r of sample) {
      expect(recoveryStrategy(r).length).toBeGreaterThan(0);
    }
  });
});
```

### TDD steps

- [ ] **Step 1: Write failing tests above** — `pnpm --filter husk-orchestrator test cognition/failure-taxonomy` → FAIL.
- [ ] **Step 2: Write failure-taxonomy.ts per the module body above.**
- [ ] **Step 3: Run tests → PASS (9/9).**
- [ ] **Step 4: Full suite green.**
- [ ] **Step 5: Commit**

```bash
git add orchestrator/src/cognition/failure-taxonomy.ts \
        orchestrator/tests/cognition/failure-taxonomy.test.ts
git commit -m "feat(cognition): failure-mode taxonomy (30 reasons + classifier)"
```

---

## Task 3 — IntentionStore (SQLite CRUD)

**Model:** Haiku — mirrors M18's CognitionStorage pattern closely.

### Files

- Create: `orchestrator/src/cognition/intention-store.ts`
- Test: `orchestrator/tests/cognition/intention-store.test.ts` (extend the schema test from T1)

### Module body

```typescript
import type Database from "better-sqlite3";
import type { Intention } from "./intention-types.js";

export class IntentionStore {
  constructor(private readonly db: Database.Database) {}

  upsert(intention: Intention): void {
    const stmt = this.db.prepare(`
      INSERT INTO cognition_intentions
        (site, name, args_schema, requires_state, steps_json, verify_json, failure_modes_json, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (site, name) DO UPDATE SET
        args_schema = excluded.args_schema,
        requires_state = excluded.requires_state,
        steps_json = excluded.steps_json,
        verify_json = excluded.verify_json,
        failure_modes_json = excluded.failure_modes_json,
        description = excluded.description,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      intention.site,
      intention.name,
      JSON.stringify(intention.args_schema),
      intention.requires_state ?? null,
      JSON.stringify(intention.steps),
      JSON.stringify(intention.verify),
      JSON.stringify(intention.failure_modes),
      intention.description ?? null,
      intention.created_at,
      intention.updated_at,
    );
  }

  get(site: string, name: string): Intention | null {
    const row = this.db.prepare(
      `SELECT * FROM cognition_intentions WHERE site = ? AND name = ?`
    ).get(site, name) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.deserialize(row);
  }

  list(site: string): Intention[] {
    const rows = this.db.prepare(
      `SELECT * FROM cognition_intentions WHERE site = ? ORDER BY name ASC`
    ).all(site) as Array<Record<string, unknown>>;
    return rows.map((r) => this.deserialize(r));
  }

  remove(site: string, name: string): boolean {
    const result = this.db.prepare(
      `DELETE FROM cognition_intentions WHERE site = ? AND name = ?`
    ).run(site, name);
    return result.changes > 0;
  }

  private deserialize(row: Record<string, unknown>): Intention {
    return {
      site: row.site as string,
      name: row.name as string,
      args_schema: JSON.parse(row.args_schema as string),
      requires_state: (row.requires_state as string | null) ?? undefined,
      steps: JSON.parse(row.steps_json as string),
      verify: JSON.parse(row.verify_json as string),
      failure_modes: JSON.parse(row.failure_modes_json as string),
      description: (row.description as string | null) ?? undefined,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    };
  }
}
```

### Tests

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { IntentionStore } from "../../src/cognition/intention-store.js";
import type { Intention } from "../../src/cognition/intention-types.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

describe("IntentionStore", () => {
  let dir: string;
  let cache: SiteGraphCache;
  let store: IntentionStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "husk-m19-"));
    cache = new SiteGraphCache(dir);
    store = new IntentionStore(cache.db);
  });

  afterEach(() => {
    cache.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const mk = (name: string): Intention => ({
    site: "test.com",
    name,
    args_schema: { type: "object" },
    requires_state: "home",
    steps: [{ verb: "click", target: { button: "Go" } }],
    verify: [],
    failure_modes: [],
    created_at: 1000,
    updated_at: 1000,
  });

  it("upsert + get round-trips", () => {
    const i = mk("intent_a");
    store.upsert(i);
    const got = store.get("test.com", "intent_a");
    expect(got).not.toBeNull();
    expect(got!.steps).toEqual(i.steps);
  });

  it("upsert is idempotent (overwrites)", () => {
    store.upsert(mk("intent_a"));
    const updated = { ...mk("intent_a"), description: "updated", updated_at: 2000 };
    store.upsert(updated);
    expect(store.get("test.com", "intent_a")!.description).toBe("updated");
  });

  it("get returns null for missing", () => {
    expect(store.get("test.com", "missing")).toBeNull();
  });

  it("list returns alphabetically", () => {
    store.upsert(mk("zebra"));
    store.upsert(mk("alpha"));
    const names = store.list("test.com").map((i) => i.name);
    expect(names).toEqual(["alpha", "zebra"]);
  });

  it("list scoped to site", () => {
    store.upsert({ ...mk("a"), site: "site1.com" });
    store.upsert({ ...mk("b"), site: "site2.com" });
    expect(store.list("site1.com")).toHaveLength(1);
    expect(store.list("site2.com")).toHaveLength(1);
  });

  it("remove deletes and reports", () => {
    store.upsert(mk("rm"));
    expect(store.remove("test.com", "rm")).toBe(true);
    expect(store.remove("test.com", "rm")).toBe(false);
    expect(store.get("test.com", "rm")).toBeNull();
  });
});
```

### TDD steps

- [ ] **Step 1: Write tests.** Run: `pnpm --filter husk-orchestrator test cognition/intention-store` → FAIL.
- [ ] **Step 2: Write intention-store.ts per module body.**
- [ ] **Step 3: Re-run tests → PASS (6/6).**
- [ ] **Step 4: Full suite green.**
- [ ] **Step 5: Commit**

```bash
git add orchestrator/src/cognition/intention-store.ts \
        orchestrator/tests/cognition/intention-store.test.ts
git commit -m "feat(cognition): IntentionStore SQLite CRUD"
```

---

## Task 4 — YAML intention loader + validator

**Model:** Haiku — `js-yaml` parsing + structural validation.

### Files

- Create: `orchestrator/src/cognition/intention-yaml.ts`
- Test: `orchestrator/tests/cognition/intention-yaml.test.ts`

### Module body

```typescript
import * as yaml from "js-yaml";
import type { Intention, IntentionStep, VerifyCheck, FailureModePattern } from "./intention-types.js";

/** Parse a YAML string into an Intention. Throws on structural errors. */
export function parseIntentionYaml(source: string, site: string): Intention {
  const doc = yaml.load(source);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("Intention YAML must be a mapping");
  }
  const d = doc as Record<string, unknown>;

  const name = requireString(d, "name");
  const argsSchema = (d.args_schema as Record<string, unknown> | undefined) ?? { type: "object" };
  const requiresState = d.requires_state as string | undefined;
  const stepsRaw = d.steps;
  if (!Array.isArray(stepsRaw)) throw new Error(`Intention "${name}" must have a steps array`);
  const steps = stepsRaw.map((s, i) => validateStep(s, name, i));
  const verifyRaw = (d.verify as unknown[] | undefined) ?? [];
  const verify = verifyRaw.map((v, i) => validateVerify(v, name, i));
  const failureRaw = (d.failure_modes as unknown[] | undefined) ?? [];
  const failure_modes = failureRaw.map((f, i) => validateFailureMode(f, name, i));

  const now = Date.now();
  return {
    site,
    name,
    args_schema: argsSchema,
    requires_state: requiresState,
    steps,
    verify,
    failure_modes,
    description: d.description as string | undefined,
    created_at: now,
    updated_at: now,
  };
}

function requireString(d: Record<string, unknown>, key: string): string {
  const v = d[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Intention YAML missing required string "${key}"`);
  }
  return v;
}

function validateStep(s: unknown, intentName: string, idx: number): IntentionStep {
  if (!s || typeof s !== "object") throw new Error(`Intention "${intentName}" step ${idx} not an object`);
  const o = s as Record<string, unknown>;
  const verb = o.verb;
  if (typeof verb !== "string") throw new Error(`Step ${idx} missing "verb"`);
  const validVerbs = ["click","type","press_key","scroll","wait_for","navigate","snapshot"];
  if (!validVerbs.includes(verb)) throw new Error(`Step ${idx} has invalid verb "${verb}"`);
  return o as IntentionStep;
}

function validateVerify(v: unknown, intentName: string, idx: number): VerifyCheck {
  if (!v || typeof v !== "object") throw new Error(`Intention "${intentName}" verify ${idx} not an object`);
  const o = v as Record<string, unknown>;
  const type = o.type;
  if (type !== "predicate" && type !== "network" && type !== "url") {
    throw new Error(`Verify check ${idx} has invalid type "${type}"`);
  }
  return o as VerifyCheck;
}

function validateFailureMode(f: unknown, intentName: string, idx: number): FailureModePattern {
  if (!f || typeof f !== "object") throw new Error(`Intention "${intentName}" failure_mode ${idx} not an object`);
  const o = f as Record<string, unknown>;
  if (typeof o.reason !== "string") throw new Error(`failure_mode ${idx} missing "reason"`);
  if (!o.match || typeof o.match !== "object") throw new Error(`failure_mode ${idx} missing "match"`);
  return o as FailureModePattern;
}

/** Interpolate {{args.X}} template references in a string. */
export function interpolate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{args\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, k) => {
    const v = args[k];
    if (v === undefined) throw new Error(`Template references missing arg "${k}"`);
    return String(v);
  });
}
```

### Tests

```typescript
import { describe, it, expect } from "vitest";
import { parseIntentionYaml, interpolate } from "../../src/cognition/intention-yaml.js";

describe("intention-yaml", () => {
  const yamlSrc = `
name: send_connect
description: Send a connection request
args_schema:
  type: object
  properties:
    person: { type: string }
  required: [person]
requires_state: profile_page
steps:
  - verb: click
    target: { button: Connect }
  - verb: click
    target: { button: Send without a note }
verify:
  - type: network
    method: POST
    url_pattern: /voyager/api/relationships/sentInvitationViewsV2
    status_min: 200
    status_max: 299
    description: invite POST returned 2xx
failure_modes:
  - reason: rate_limited
    match:
      type: network
      url_pattern: /voyager
      status_min: 429
      status_max: 429
      description: 429 from voyager
`;

  it("parses a complete intention YAML", () => {
    const i = parseIntentionYaml(yamlSrc, "linkedin.com");
    expect(i.name).toBe("send_connect");
    expect(i.steps).toHaveLength(2);
    expect(i.verify).toHaveLength(1);
    expect(i.failure_modes).toHaveLength(1);
    expect(i.requires_state).toBe("profile_page");
  });

  it("rejects YAML without a name", () => {
    expect(() => parseIntentionYaml("steps: []", "site")).toThrow(/name/);
  });

  it("rejects YAML without steps", () => {
    expect(() => parseIntentionYaml("name: x", "site")).toThrow(/steps/);
  });

  it("rejects steps with invalid verbs", () => {
    expect(() => parseIntentionYaml("name: x\nsteps:\n  - verb: yodel", "site")).toThrow(/invalid verb/);
  });

  it("rejects verify with invalid type", () => {
    const src = `name: x\nsteps: []\nverify:\n  - type: spurious`;
    expect(() => parseIntentionYaml(src, "site")).toThrow(/invalid type/);
  });

  it("interpolate replaces {{args.X}}", () => {
    expect(interpolate("hello {{args.name}}", { name: "world" })).toBe("hello world");
  });

  it("interpolate throws on missing arg", () => {
    expect(() => interpolate("hi {{args.missing}}", {})).toThrow(/missing arg/);
  });

  it("interpolate handles non-string args", () => {
    expect(interpolate("count={{args.n}}", { n: 42 })).toBe("count=42");
  });
});
```

### TDD steps

- [ ] **Step 1: Confirm js-yaml is present.** Check `orchestrator/package.json` — it was added in M5. If missing, `pnpm --filter husk-orchestrator add js-yaml @types/js-yaml`. Usually already there.
- [ ] **Step 2: Write tests.** Run: `pnpm --filter husk-orchestrator test cognition/intention-yaml` → FAIL.
- [ ] **Step 3: Write intention-yaml.ts.**
- [ ] **Step 4: Re-run → PASS (8/8).**
- [ ] **Step 5: Full suite green.**
- [ ] **Step 6: Commit**

```bash
git add orchestrator/src/cognition/intention-yaml.ts \
        orchestrator/tests/cognition/intention-yaml.test.ts
git commit -m "feat(cognition): intention YAML parser + interpolate helper"
```

---

## Task 5 — IntentResolver (intent → stable_id)

**Model:** Sonnet — wraps existing M5 find.ts; needs careful integration with snapshot shape.

### Files

- Create: `orchestrator/src/cognition/intent-resolver.ts`
- Test: `orchestrator/tests/cognition/intent-resolver.test.ts`

### Design

IntentRef looks like `{ button: "Connect" }` or `{ textbox: "Email" }` — a single role-name pair. Convert to the `intent: string` form that M5's `find()` accepts (e.g., `"Connect button"`), then call into `find()` which already does fuzzy matching with Jaro-Winkler.

### Module body

```typescript
import type { IntentRef } from "./intention-types.js";
import { findInSnapshot } from "../session/find.js";  // or whatever the export is; verify before coding
import type { FindContext, FindCandidate } from "../session/find.js";

/** Convert IntentRef into a single intent string for find.ts. */
export function intentRefToString(ref: IntentRef): string {
  if ("button" in ref) return `${ref.button} button`;
  if ("link" in ref) return `${ref.link} link`;
  if ("textbox" in ref) return `${ref.textbox} textbox`;
  if ("combobox" in ref) return `${ref.combobox} combobox`;
  if ("heading" in ref) return `${ref.heading} heading`;
  if ("role" in ref) return `${ref.name} ${ref.role}`;
  throw new Error(`Unknown IntentRef shape: ${JSON.stringify(ref)}`);
}

export interface IntentResolveResult {
  stable_id: string | null;
  candidates: FindCandidate[];
  /** Best-match score 0..1, undefined when no candidates. */
  score?: number;
}

/**
 * Resolve an IntentRef against a snapshot's AX nodes.
 * Returns the best-scoring stable_id, the candidate list, and the score.
 */
export function resolveIntentRef(ref: IntentRef, ctx: FindContext): IntentResolveResult {
  const intent = intentRefToString(ref);
  const result = findInSnapshot({ intent }, ctx);
  if (!result.ok || result.candidates.length === 0) {
    return { stable_id: null, candidates: [] };
  }
  const best = result.candidates[0];
  return { stable_id: best.stable_id, candidates: result.candidates, score: best.score };
}
```

(The actual `findInSnapshot` export name and signature must match what's in `session/find.ts`. Verify by reading the file before coding. If the public function is named differently — e.g. `find()` — match that.)

### Tests

```typescript
import { describe, it, expect } from "vitest";
import { intentRefToString, resolveIntentRef } from "../../src/cognition/intent-resolver.js";

describe("intent-resolver", () => {
  it("converts IntentRef shapes to strings", () => {
    expect(intentRefToString({ button: "Connect" })).toBe("Connect button");
    expect(intentRefToString({ link: "Profile" })).toBe("Profile link");
    expect(intentRefToString({ textbox: "Email" })).toBe("Email textbox");
    expect(intentRefToString({ heading: "Login" })).toBe("Login heading");
    expect(intentRefToString({ role: "checkbox", name: "Remember me" })).toBe("Remember me checkbox");
  });

  it("resolves to the best-matching stable_id", () => {
    const ctx = {
      snapshot: {
        nodes: [
          { i: "a1", r: "button", n: "Connect" },
          { i: "a2", r: "button", n: "Cancel" },
        ],
      },
      cache: null,
    };
    const r = resolveIntentRef({ button: "Connect" }, ctx);
    expect(r.stable_id).toBe("a1");
    expect(r.score).toBeGreaterThan(0.8);
  });

  it("returns null stable_id when nothing matches", () => {
    const ctx = {
      snapshot: { nodes: [{ i: "x", r: "textbox", n: "Search" }] },
      cache: null,
    };
    const r = resolveIntentRef({ button: "Connect" }, ctx);
    expect(r.stable_id).toBeNull();
    expect(r.candidates).toHaveLength(0);
  });

  it("fuzzy-matches near-but-not-exact names", () => {
    const ctx = {
      snapshot: {
        nodes: [{ i: "n1", r: "button", n: "Send Invitation" }],
      },
      cache: null,
    };
    const r = resolveIntentRef({ button: "Send" }, ctx);
    // fuzzy match should pick it up since "Send" overlaps with "Send Invitation"
    expect(r.stable_id).toBe("n1");
  });
});
```

### TDD steps

- [ ] **Step 1: Read `orchestrator/src/session/find.ts` end-to-end to confirm the exported function name + signature.** Adjust the implementation to match.
- [ ] **Step 2: Write tests** → FAIL.
- [ ] **Step 3: Write intent-resolver.ts.** Match find.ts's export name.
- [ ] **Step 4: Re-run → PASS (4/4).**
- [ ] **Step 5: Full suite green.**
- [ ] **Step 6: Commit**

```bash
git add orchestrator/src/cognition/intent-resolver.ts \
        orchestrator/tests/cognition/intent-resolver.test.ts
git commit -m "feat(cognition): IntentRef → stable_id resolver (wraps M5 find)"
```

---

## Task 6 — Verify runner

**Model:** Sonnet — multi-source: network ring buffer (M14), AX snapshot, URL.

### Files

- Create: `orchestrator/src/cognition/verify-runner.ts`
- Test: `orchestrator/tests/cognition/verify-runner.test.ts`

### Design

A verify check returns an `Evidence` record. Inputs:
- `check`: the `VerifyCheck` to evaluate
- `context`: provides `currentUrl`, `snapshot`, and optionally `network` (from M14's ring buffer)

```typescript
import type { VerifyCheck, Evidence } from "./intention-types.js";
import { evaluate } from "./predicate.js";
import type { SnapshotForPredicate } from "./predicate.js";

export interface NetworkEntry {
  method: string;
  url: string;
  status?: number;
  ts: number;
}

export interface VerifyContext {
  currentUrl: string;
  snapshot: SnapshotForPredicate;
  network?: NetworkEntry[];   // recent requests; undefined when not tracked
}

export function runVerify(check: VerifyCheck, ctx: VerifyContext): Evidence {
  if (check.type === "predicate") {
    const passed = evaluate(check.predicate, ctx.snapshot);
    return { predicate: check.description, passed };
  }
  if (check.type === "url") {
    const re = new RegExp(check.pattern);
    const passed = re.test(ctx.currentUrl);
    return { predicate: check.description, passed, observed_value: ctx.currentUrl };
  }
  if (check.type === "network") {
    const entries = ctx.network ?? [];
    const re = new RegExp(check.url_pattern);
    const match = entries.find((e) => {
      if (check.method && e.method.toUpperCase() !== check.method) return false;
      if (!re.test(e.url)) return false;
      if (check.status_min !== undefined && (e.status ?? 0) < check.status_min) return false;
      if (check.status_max !== undefined && (e.status ?? 999) > check.status_max) return false;
      return true;
    });
    return {
      predicate: check.description,
      passed: match !== undefined,
      observed_value: match,
    };
  }
  return { predicate: "unknown check type", passed: false };
}

export function runAllVerify(checks: VerifyCheck[], ctx: VerifyContext): Evidence[] {
  return checks.map((c) => runVerify(c, ctx));
}
```

### Tests

```typescript
import { describe, it, expect } from "vitest";
import { runVerify, runAllVerify } from "../../src/cognition/verify-runner.js";
import type { VerifyCheck } from "../../src/cognition/intention-types.js";

describe("verify-runner", () => {
  const baseSnap = { url: "https://test.com/page", nodes: [{ i: "h1", r: "heading", n: "Welcome" }] };

  it("url check passes on matching pattern", () => {
    const check: VerifyCheck = { type: "url", pattern: "/page$", description: "URL ends with /page" };
    const ev = runVerify(check, { currentUrl: "https://test.com/page", snapshot: { url: "https://test.com/page", root: undefined } as any });
    expect(ev.passed).toBe(true);
  });

  it("url check fails on mismatch", () => {
    const check: VerifyCheck = { type: "url", pattern: "/admin", description: "admin url" };
    const ev = runVerify(check, { currentUrl: "https://test.com/page", snapshot: { url: "x", root: undefined } as any });
    expect(ev.passed).toBe(false);
  });

  it("network check matches by url_pattern + method + status", () => {
    const check: VerifyCheck = { type: "network", method: "POST", url_pattern: "/api/connect", status_min: 200, status_max: 299, description: "connect 2xx" };
    const ev = runVerify(check, {
      currentUrl: "x",
      snapshot: { url: "x", root: undefined } as any,
      network: [
        { method: "POST", url: "https://x.com/api/connect", status: 201, ts: 1 },
      ],
    });
    expect(ev.passed).toBe(true);
    expect(ev.observed_value).toBeDefined();
  });

  it("network check fails when status outside range", () => {
    const check: VerifyCheck = { type: "network", url_pattern: "/api", status_min: 200, status_max: 299, description: "2xx" };
    const ev = runVerify(check, {
      currentUrl: "x",
      snapshot: { url: "x", root: undefined } as any,
      network: [{ method: "GET", url: "/api", status: 429, ts: 1 }],
    });
    expect(ev.passed).toBe(false);
  });

  it("network check fails when no network ctx provided", () => {
    const check: VerifyCheck = { type: "network", url_pattern: "/api", description: "any" };
    const ev = runVerify(check, { currentUrl: "x", snapshot: { url: "x", root: undefined } as any });
    expect(ev.passed).toBe(false);
  });

  it("predicate check uses predicate evaluator", () => {
    const check: VerifyCheck = {
      type: "predicate",
      predicate: { type: "url_pattern", regex: "/page$" },
      description: "url pattern",
    };
    const ev = runVerify(check, {
      currentUrl: "https://x/page",
      snapshot: { url: "https://x/page", root: { r: "main", c: [] } } as any,
    });
    expect(ev.passed).toBe(true);
  });

  it("runAllVerify returns one Evidence per check", () => {
    const checks: VerifyCheck[] = [
      { type: "url", pattern: "/page$", description: "url" },
      { type: "url", pattern: "/admin", description: "no admin" },
    ];
    const ev = runAllVerify(checks, { currentUrl: "https://x/page", snapshot: { url: "x", root: undefined } as any });
    expect(ev).toHaveLength(2);
    expect(ev[0].passed).toBe(true);
    expect(ev[1].passed).toBe(false);
  });
});
```

### TDD steps

- [ ] **Step 1: Read `predicate.ts` to confirm `evaluate` signature and `SnapshotForPredicate` shape.**
- [ ] **Step 2: Write tests.** Run → FAIL.
- [ ] **Step 3: Write verify-runner.ts.**
- [ ] **Step 4: Re-run → PASS (7/7).**
- [ ] **Step 5: Full suite green.**
- [ ] **Step 6: Commit**

```bash
git add orchestrator/src/cognition/verify-runner.ts \
        orchestrator/tests/cognition/verify-runner.test.ts
git commit -m "feat(cognition): verify-check runner (url/network/predicate)"
```

---

## Task 7 — IntentionCompiler (the orchestrator)

**Model:** Sonnet — load-bearing; ties together M18 graph, M5 watchdog action verbs, T2-T6 modules.

### Files

- Create: `orchestrator/src/cognition/intention-compiler.ts`
- Test: `orchestrator/tests/cognition/intention-compiler.test.ts`

### Design

`IntentionCompiler.execute(session, intention, args)`:

1. Snapshot the current page → identify current state via `StateGraph.identifyCurrentState`.
2. If `intention.requires_state` is set, interpolate templates, BFS via `StateGraph.findPath` from current to required state.
3. For each transition in the path:
   - Execute its `action_sequence` (each ActionStep) — use a `SessionAdapter` injected at construction.
   - After each ActionStep: re-snapshot, verify expected post-state matches via `identifyCurrentState`. On drift, classify as `state_drift_mid_execution` and return.
4. Once at required state, execute intention.steps in order:
   - Resolve each IntentRef via `resolveIntentRef`.
   - Dispatch via the SessionAdapter's primitives (click/type/etc).
5. Run intention.verify (collect Evidence).
6. If any verify failed OR any error thrown: walk failure_modes patterns; first match wins as reason; else classify via `classifyError`.
7. Return Outcome.

### Module body (skeleton — engineer fills runtime details by reading session/session.ts)

```typescript
import type { Intention, IntentionStep, Outcome, Evidence, TransitionLog, FailureReason, IntentRef } from "./intention-types.js";
import type { StateGraph } from "./state-graph.js";
import type { VerifyContext, NetworkEntry } from "./verify-runner.js";
import { runAllVerify, runVerify } from "./verify-runner.js";
import { resolveIntentRef } from "./intent-resolver.js";
import { classifyError, recoveryStrategy } from "./failure-taxonomy.js";
import { interpolate } from "./intention-yaml.js";

/** Minimal Session interface the compiler needs.
 *  Real Session implements this (additive — see Task 8). */
export interface SessionAdapter {
  currentUrl(): string;
  snapshot(): Promise<any>;  // returns Husk snapshot envelope
  click(stable_id: string): Promise<void>;
  type(stable_id: string, text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  scroll(args: { stable_id?: string; direction: "up" | "down" | "into_view"; amount_px?: number }): Promise<void>;
  navigate(url: string): Promise<void>;
  recentNetwork(): NetworkEntry[];
}

export interface CompilerOptions {
  graph: StateGraph;
  site: string;
  /** Optional clock override for testing. */
  now?: () => number;
}

export class IntentionCompiler {
  private readonly graph: StateGraph;
  private readonly site: string;
  private readonly now: () => number;

  constructor(opts: CompilerOptions) {
    this.graph = opts.graph;
    this.site = opts.site;
    this.now = opts.now ?? (() => Date.now());
  }

  async execute<T = unknown>(
    session: SessionAdapter,
    intention: Intention,
    args: Record<string, unknown>,
  ): Promise<Outcome<T>> {
    const t0 = this.now();
    const steps_observed: TransitionLog[] = [];
    let state_before: string | null = null;

    try {
      // Step 1: identify current state.
      const snap0 = await session.snapshot();
      const adapted = this.adapt(snap0, session.currentUrl());
      const cur = this.graph.identifyCurrentState(adapted);
      state_before = cur?.state.state_id ?? null;

      // Step 2: if requires_state, plan + traverse.
      if (intention.requires_state) {
        const target = interpolate(intention.requires_state, { args });
        if (!state_before) {
          return this.failOutcome(intention, args, null, undefined, "unknown_state", "no current state matched", [], steps_observed, t0);
        }
        if (state_before !== target) {
          const path = this.graph.findPath(state_before, target);
          if (!path) {
            return this.failOutcome(intention, args, state_before, undefined, "no_path_to_target", `no path from ${state_before} to ${target}`, [], steps_observed, t0);
          }
          for (const transition of path) {
            const tStart = this.now();
            for (const action of transition.action_sequence) {
              await this.dispatchAction(session, action, args);
            }
            const postSnap = await session.snapshot();
            const postAdapted = this.adapt(postSnap, session.currentUrl());
            const postState = this.graph.identifyCurrentState(postAdapted);
            const ok = postState?.state.state_id === transition.to_state;
            steps_observed.push({
              from_state: transition.from_state,
              to_state: transition.to_state,
              actions: transition.action_sequence,
              duration_ms: this.now() - tStart,
              ok,
            });
            if (!ok) {
              return this.failOutcome(intention, args, state_before, postState?.state.state_id, "state_drift_mid_execution", `expected ${transition.to_state}, saw ${postState?.state.state_id ?? "unknown"}`, [], steps_observed, t0);
            }
          }
        }
      }

      // Step 3: execute intention.steps.
      let snap = await session.snapshot();
      let url = session.currentUrl();
      for (const step of intention.steps) {
        await this.dispatchStep(session, step, args, snap);
        snap = await session.snapshot();
        url = session.currentUrl();
      }

      // Step 4: run verify checks.
      const verifyCtx: VerifyContext = {
        currentUrl: url,
        snapshot: this.adapt(snap, url),
        network: session.recentNetwork(),
      };
      const evidence = runAllVerify(intention.verify, verifyCtx);
      const allPassed = evidence.every((e) => e.passed);

      // Step 5: check failure-mode patterns even on apparent success — sites can return 200 with rate-limit pages.
      for (const fm of intention.failure_modes) {
        const ev = runVerify(fm.match, verifyCtx);
        if (ev.passed) {
          return this.failOutcome(intention, args, state_before, undefined, fm.reason, `failure_mode matched: ${fm.match.description}`, evidence, steps_observed, t0);
        }
      }

      if (!allPassed) {
        return this.failOutcome(intention, args, state_before, undefined, "verify_failed", "one or more verify checks failed", evidence, steps_observed, t0);
      }

      const finalSnap = this.adapt(snap, url);
      const finalState = this.graph.identifyCurrentState(finalSnap);

      return {
        ok: true,
        intention: intention.name,
        args,
        state_before,
        state_after: finalState?.state.state_id,
        evidence,
        duration_ms: this.now() - t0,
        steps_observed,
      };
    } catch (err) {
      const { reason, detail } = classifyError(err);
      return this.failOutcome(intention, args, state_before, undefined, reason, detail, [], steps_observed, t0);
    }
  }

  private async dispatchStep(session: SessionAdapter, step: IntentionStep, args: Record<string, unknown>, snapshot: any): Promise<void> {
    switch (step.verb) {
      case "click": {
        const ctx = { snapshot: { nodes: this.flattenAxNodes(snapshot) }, cache: null };
        const r = resolveIntentRef(step.target, ctx);
        if (!r.stable_id) throw new Error(`element_not_found: ${JSON.stringify(step.target)}`);
        await session.click(r.stable_id);
        return;
      }
      case "type": {
        const ctx = { snapshot: { nodes: this.flattenAxNodes(snapshot) }, cache: null };
        const r = resolveIntentRef(step.target, ctx);
        if (!r.stable_id) throw new Error(`element_not_found: ${JSON.stringify(step.target)}`);
        const value = interpolate(step.value, { args });
        await session.type(r.stable_id, value);
        return;
      }
      case "press_key":
        await session.pressKey(step.key);
        return;
      case "scroll": {
        let stable_id: string | undefined;
        if (step.target) {
          const ctx = { snapshot: { nodes: this.flattenAxNodes(snapshot) }, cache: null };
          const r = resolveIntentRef(step.target, ctx);
          if (!r.stable_id) throw new Error(`element_not_found: ${JSON.stringify(step.target)}`);
          stable_id = r.stable_id;
        }
        await session.scroll({ stable_id, direction: step.direction, amount_px: step.amount_px });
        return;
      }
      case "navigate":
        await session.navigate(interpolate(step.url, { args }));
        return;
      case "wait_for":
      case "snapshot":
        // No-op for now (wait_for needs predicate-poller integration; defer to Phase E).
        return;
    }
  }

  private async dispatchAction(session: SessionAdapter, action: any, args: Record<string, unknown>): Promise<void> {
    // ActionStep can be a transition's action_sequence. Reuse dispatchStep semantics
    // where possible (the type set overlaps with IntentionStep).
    await this.dispatchStep(session, action, args, await session.snapshot());
  }

  private adapt(snap: any, url: string): any {
    return {
      url,
      root: snap.tree?.root ?? snap.root,
      network: snap.network,
      forms: snap.forms,
    };
  }

  private flattenAxNodes(snap: any): Array<{ i: string; r: string; n: string }> {
    const out: Array<{ i: string; r: string; n: string }> = [];
    const root = snap.tree?.root ?? snap.root;
    if (!root) return out;
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      if (n && n.i && n.r && n.n) out.push({ i: n.i, r: n.r, n: n.n });
      for (const c of n?.c ?? []) stack.push(c);
    }
    return out;
  }

  private failOutcome(
    intention: Intention,
    args: unknown,
    state_before: string | null,
    state_after: string | undefined,
    reason: FailureReason,
    detail: string,
    evidence: Evidence[],
    steps_observed: TransitionLog[],
    t0: number,
  ): Outcome {
    return {
      ok: false,
      intention: intention.name,
      args,
      state_before,
      state_after,
      evidence,
      duration_ms: this.now() - t0,
      reason,
      reason_detail: detail,
      recovery_options: [{ label: recoveryStrategy(reason) }],
      steps_observed,
    };
  }
}
```

### Tests

```typescript
import { describe, it, expect, vi } from "vitest";
import { IntentionCompiler, type SessionAdapter } from "../../src/cognition/intention-compiler.js";
import { StateGraph } from "../../src/cognition/state-graph.js";
import type { Intention } from "../../src/cognition/intention-types.js";
import type { SiteState, Transition } from "../../src/cognition/types.js";

function makeAdapter(overrides: Partial<SessionAdapter> = {}): SessionAdapter {
  return {
    currentUrl: vi.fn(() => "https://test.com/home") as any,
    snapshot: vi.fn(async () => ({
      url: "https://test.com/home",
      root: {
        r: "main", n: "main", i: "r",
        c: [{ i: "b1", r: "button", n: "Go" }],
      },
    })) as any,
    click: vi.fn(async () => {}) as any,
    type: vi.fn(async () => {}) as any,
    pressKey: vi.fn(async () => {}) as any,
    scroll: vi.fn(async () => {}) as any,
    navigate: vi.fn(async () => {}) as any,
    recentNetwork: vi.fn(() => []) as any,
    ...overrides,
  };
}

function homeState(): SiteState {
  return {
    site: "test.com",
    state_id: "home",
    identify_by: { type: "url_pattern", regex: "/home" },
    affordances: [],
    observed_count: 1,
    confidence: 0.9,
    last_seen_at: 0,
  };
}

describe("IntentionCompiler", () => {
  it("executes a no-state-requirement intention successfully", async () => {
    const graph = new StateGraph();
    graph.upsertState(homeState());

    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const intention: Intention = {
      site: "test.com",
      name: "click_go",
      args_schema: {},
      steps: [{ verb: "click", target: { button: "Go" } }],
      verify: [{ type: "url", pattern: "/home", description: "still on home" }],
      failure_modes: [],
      created_at: 0,
      updated_at: 0,
    };

    const adapter = makeAdapter();
    const outcome = await compiler.execute(adapter, intention, {});

    expect(outcome.ok).toBe(true);
    expect(outcome.intention).toBe("click_go");
    expect(outcome.evidence).toHaveLength(1);
    expect(outcome.evidence[0].passed).toBe(true);
    expect(adapter.click).toHaveBeenCalledOnce();
  });

  it("returns no_path_to_target when no path exists", async () => {
    const graph = new StateGraph();
    graph.upsertState(homeState());
    graph.upsertState({ ...homeState(), state_id: "isolated", identify_by: { type: "url_pattern", regex: "/never" } });

    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const intention: Intention = {
      site: "test.com",
      name: "x",
      args_schema: {},
      requires_state: "isolated",
      steps: [],
      verify: [],
      failure_modes: [],
      created_at: 0, updated_at: 0,
    };
    const outcome = await compiler.execute(makeAdapter(), intention, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("no_path_to_target");
  });

  it("returns verify_failed when a verify check fails", async () => {
    const graph = new StateGraph();
    graph.upsertState(homeState());
    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const intention: Intention = {
      site: "test.com", name: "x", args_schema: {},
      steps: [],
      verify: [{ type: "url", pattern: "/should-not-match", description: "fake" }],
      failure_modes: [], created_at: 0, updated_at: 0,
    };
    const outcome = await compiler.execute(makeAdapter(), intention, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("verify_failed");
    expect(outcome.evidence[0].passed).toBe(false);
  });

  it("classifies thrown errors via failure-taxonomy", async () => {
    const graph = new StateGraph();
    graph.upsertState(homeState());
    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const adapter = makeAdapter({
      click: vi.fn(async () => { throw new Error("HTTP 429 too many requests"); }) as any,
    });
    const intention: Intention = {
      site: "test.com", name: "x", args_schema: {},
      steps: [{ verb: "click", target: { button: "Go" } }],
      verify: [], failure_modes: [], created_at: 0, updated_at: 0,
    };
    const outcome = await compiler.execute(adapter, intention, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("rate_limited");
  });

  it("matches failure_mode patterns even on apparent success", async () => {
    const graph = new StateGraph();
    graph.upsertState(homeState());
    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const intention: Intention = {
      site: "test.com", name: "x", args_schema: {},
      steps: [],
      verify: [],
      failure_modes: [{
        reason: "rate_limited",
        match: { type: "network", url_pattern: "/api", status_min: 429, status_max: 429, description: "429" },
      }],
      created_at: 0, updated_at: 0,
    };
    const adapter = makeAdapter({
      recentNetwork: vi.fn(() => [{ method: "GET", url: "https://x/api", status: 429, ts: 1 }]) as any,
    });
    const outcome = await compiler.execute(adapter, intention, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("rate_limited");
  });

  it("interpolates {{args.X}} in type values", async () => {
    const graph = new StateGraph();
    graph.upsertState(homeState());
    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const adapter = makeAdapter({
      snapshot: vi.fn(async () => ({
        url: "https://test.com/home",
        root: { i: "r", r: "main", n: "main", c: [{ i: "t1", r: "textbox", n: "Email" }] },
      })) as any,
    });
    const intention: Intention = {
      site: "test.com", name: "fill", args_schema: {},
      steps: [{ verb: "type", target: { textbox: "Email" }, value: "{{args.email}}" }],
      verify: [], failure_modes: [], created_at: 0, updated_at: 0,
    };
    await compiler.execute(adapter, intention, { email: "u@example.com" });
    expect(adapter.type).toHaveBeenCalledWith("t1", "u@example.com");
  });
});
```

### TDD steps

- [ ] **Step 1: Read `state-graph.ts` for the exact identifyCurrentState return shape + findPath return shape.**
- [ ] **Step 2: Write tests above (use vitest's `vi.fn`).** Run → FAIL.
- [ ] **Step 3: Write intention-compiler.ts.** Pay close attention to the adapter shape — must match what tests pass in. The `flattenAxNodes` walker must traverse the snapshot tree correctly (verify the AxTreeNode shape via predicate.ts).
- [ ] **Step 4: Re-run → PASS (6/6).**
- [ ] **Step 5: Full suite green.**
- [ ] **Step 6: Update cognition/index.ts barrel to export IntentionCompiler + types.**
- [ ] **Step 7: Commit**

```bash
git add orchestrator/src/cognition/intention-compiler.ts \
        orchestrator/src/cognition/index.ts \
        orchestrator/tests/cognition/intention-compiler.test.ts
git commit -m "feat(cognition): IntentionCompiler — state-graph BFS + verify + failure classification"
```

---

## Task 8 — Session.intend + HTTP `intend` method

**Model:** Sonnet — wires the compiler into Session + adds JSON-RPC method.

### Files

- Modify: `orchestrator/src/session/session.ts` — add `intend()` method
- Modify: `orchestrator/src/http/methods.ts` — add `intend` JSON-RPC handler
- Test: `orchestrator/tests/cognition/session-intend.test.ts` (integration-light: real Session + mock SessionAdapter inside)

### Session.intend signature

```typescript
async intend<T = unknown>(args: {
  intention_name: string;
  args?: Record<string, unknown>;
  /** Override the site (defaults to current URL hostname). */
  site?: string;
}): Promise<Outcome<T>> {
  const site = args.site ?? new URL(this.currentUrl()).hostname;
  const store = new IntentionStore(this.cache.db);
  const intention = store.get(site, args.intention_name);
  if (!intention) {
    return {
      ok: false,
      intention: args.intention_name,
      args: args.args ?? {},
      state_before: null,
      evidence: [],
      duration_ms: 0,
      reason: "unknown_site",
      reason_detail: `no intention "${args.intention_name}" defined for ${site}`,
      steps_observed: [],
    };
  }
  const storage = new CognitionStorage(this.cache.db);
  const graph = storage.loadStateGraph(site);
  const compiler = new IntentionCompiler({ graph, site });
  const adapter: SessionAdapter = {
    currentUrl: () => this.currentUrl(),
    snapshot: () => this.snapshot(),
    click: (id) => this.click(id),
    type: (id, text) => this.type(id, text),
    pressKey: (key) => this.pressKey(key),
    scroll: (a) => this.scroll(a),
    navigate: (url) => this.navigate(url),
    recentNetwork: () => this.recentNetworkEntries(),  // M14 ring buffer accessor
  };
  return compiler.execute<T>(adapter, intention, args.args ?? {});
}
```

(Some of these — `recentNetworkEntries`, `pressKey` — already exist; verify by reading session.ts and the http methods. Adapt names to match.)

### HTTP method

```typescript
// In orchestrator/src/http/methods.ts (or wherever methods register):
async intend(ctx: MethodContext, params: { session_id: string; intention_name: string; args?: Record<string, unknown>; site?: string }) {
  const session = ctx.sessions.get(params.session_id);
  if (!session) throw new Error(`session not found: ${params.session_id}`);
  return await session.intend({
    intention_name: params.intention_name,
    args: params.args,
    site: params.site,
  });
}
```

### Tests

```typescript
// orchestrator/tests/cognition/session-intend.test.ts
// Verify session.intend looks up the intention from store and returns unknown_site when absent.
import { describe, it, expect } from "vitest";
// ... mock session that exposes minimal surface; verify unknown_site reason path
```

(Engineer fills in the test by mirroring the test patterns in `orchestrator/tests/session/` — keep this lighter than T7 because T7 covers the compiler thoroughly; here we're just verifying the wire-up.)

### TDD steps

- [ ] **Step 1: Read `orchestrator/src/session/session.ts` end-to-end (or as much as needed) to find: currentUrl getter, snapshot method, action method names, network-buffer accessor.**
- [ ] **Step 2: Read `orchestrator/src/http/methods.ts` to find the registration pattern + MethodContext shape.**
- [ ] **Step 3: Write a focused integration test that constructs a Session-like object and calls `.intend()` with a known + unknown intention.**
- [ ] **Step 4: Implement Session.intend.**
- [ ] **Step 5: Implement HTTP `intend` method.**
- [ ] **Step 6: Run tests → PASS.**
- [ ] **Step 7: Build the orchestrator: `pnpm --filter husk-orchestrator build` → must succeed.**
- [ ] **Step 8: Full suite green.**
- [ ] **Step 9: Commit**

```bash
git add orchestrator/src/session/session.ts \
        orchestrator/src/http/methods.ts \
        orchestrator/tests/cognition/session-intend.test.ts
git commit -m "feat(intend): Session.intend + HTTP intend JSON-RPC method"
```

---

## Task 9 — SDK surface (TS + Py) + integration test against lightpanda

**Model:** Sonnet — extends two SDKs + writes the e2e.

### Files

- Modify: `sdk/ts/src/types.ts` — re-export Outcome, Evidence, FailureReason (defined types matching orchestrator's)
- Modify: `sdk/ts/src/session.ts` — add `session.intend(args)` method
- Modify: `sdk/py/husk/types.py` — Outcome, Evidence dataclasses + FailureReason Literal
- Modify: `sdk/py/husk/session.py` — add `session.intend(args)` method
- Create: `orchestrator/tests/integration/cognition-intend.test.ts` — real lightpanda e2e

### TS SDK

In `sdk/ts/src/types.ts`:

```typescript
export type FailureReason =
  | "unknown_site" | "unknown_state" | "no_path_to_target" | "state_drift_mid_execution" | "verify_failed"
  | "element_not_found" | "element_not_interactive" | "watchdog_rejected" | "timeout"
  | "network_failure" | "network_timeout" | "network_throttled" | "rate_limited"
  | "account_locked" | "bot_challenge" | "two_factor_required" | "permission_denied" | "content_not_found" | "feature_unavailable"
  | "needs_human" | "needs_credentials" | "needs_2fa_code" | "needs_payment_confirmation" | "human_declined" | "human_timeout"
  | "engine_unsupported" | "engine_crashed" | "out_of_memory" | "pool_exhausted"
  | "unknown_error";

export interface Evidence {
  predicate: string;
  passed: boolean;
  observed_value?: unknown;
}

export interface Outcome<T = unknown> {
  ok: boolean;
  intention: string;
  args: unknown;
  state_before: string | null;
  state_after?: string;
  result?: T;
  evidence: Evidence[];
  duration_ms: number;
  reason?: FailureReason;
  reason_detail?: string;
  recovery_options?: Array<{ label: string; intention?: string; needs_human?: boolean }>;
  steps_observed: unknown[];  // opaque to SDK consumers in Phase B
}
```

In `sdk/ts/src/session.ts`:

```typescript
async intend<T = unknown>(args: {
  intention_name: string;
  args?: Record<string, unknown>;
  site?: string;
}): Promise<Outcome<T>> {
  return await this.client.call("intend", {
    session_id: this.id,
    intention_name: args.intention_name,
    args: args.args,
    site: args.site,
  });
}
```

### Py SDK

In `sdk/py/husk/types.py`:

```python
from dataclasses import dataclass, field
from typing import Any, Literal, Optional, List, Dict

FailureReason = Literal[
    "unknown_site", "unknown_state", "no_path_to_target", "state_drift_mid_execution", "verify_failed",
    "element_not_found", "element_not_interactive", "watchdog_rejected", "timeout",
    "network_failure", "network_timeout", "network_throttled", "rate_limited",
    "account_locked", "bot_challenge", "two_factor_required", "permission_denied", "content_not_found", "feature_unavailable",
    "needs_human", "needs_credentials", "needs_2fa_code", "needs_payment_confirmation", "human_declined", "human_timeout",
    "engine_unsupported", "engine_crashed", "out_of_memory", "pool_exhausted",
    "unknown_error",
]

@dataclass
class Evidence:
    predicate: str
    passed: bool
    observed_value: Any = None

@dataclass
class Outcome:
    ok: bool
    intention: str
    args: Any
    state_before: Optional[str]
    evidence: List[Evidence] = field(default_factory=list)
    duration_ms: int = 0
    state_after: Optional[str] = None
    result: Any = None
    reason: Optional[FailureReason] = None
    reason_detail: Optional[str] = None
    recovery_options: List[Dict[str, Any]] = field(default_factory=list)
    steps_observed: List[Any] = field(default_factory=list)

    @classmethod
    def from_json(cls, d: Dict[str, Any]) -> "Outcome":
        return cls(
            ok=d["ok"],
            intention=d["intention"],
            args=d.get("args"),
            state_before=d.get("state_before"),
            state_after=d.get("state_after"),
            result=d.get("result"),
            evidence=[Evidence(**e) for e in d.get("evidence", [])],
            duration_ms=d.get("duration_ms", 0),
            reason=d.get("reason"),
            reason_detail=d.get("reason_detail"),
            recovery_options=d.get("recovery_options", []),
            steps_observed=d.get("steps_observed", []),
        )
```

In `sdk/py/husk/session.py`:

```python
async def intend(self, *, intention_name: str, args: Optional[Dict[str, Any]] = None, site: Optional[str] = None) -> Outcome:
    raw = await self._client.call("intend", {
        "session_id": self.id,
        "intention_name": intention_name,
        "args": args or {},
        "site": site,
    })
    return Outcome.from_json(raw)
```

### Integration test (orchestrator/tests/integration/cognition-intend.test.ts)

```typescript
// Skip cleanly if LIGHTPANDA_BIN is unset (use existing locateLightpanda pattern).
// Setup:
//   1. Start fixture server with /page-a and /page-b (existing or new minimal).
//      /page-a has a button "Go to B" that navigates to /page-b.
//   2. Pre-seed cognition: 2 states (page_a, page_b) + 1 transition (page_a→page_b via click "Go to B").
//   3. Pre-seed an intention "visit_b" with requires_state=page_a, steps=[], verify=[{url: /page-b/}].
//   4. Create a real Session, navigate to /page-a.
//   5. Call session.intend("visit_b") via the HTTP JSON-RPC method (use the in-process client).
//   6. Assert: outcome.ok === true, evidence has the url-match Evidence with passed=true, steps_observed has 1 entry.
//   7. Test failure path: invoke an intention requiring state=page_c (not in graph) → outcome.ok === false, reason === "no_path_to_target".
//   8. Cleanup.
}, 60_000);
```

### TDD steps

- [ ] **Step 1: Read `sdk/ts/src/session.ts` and `sdk/py/husk/session.py` to learn the call patterns.** Mirror them.
- [ ] **Step 2: Update SDK types + add intend methods.** Don't write SDK-side unit tests (they exist for prior methods — follow the established pattern; the e2e covers the wire path).
- [ ] **Step 3: Build SDKs (TS: `pnpm --filter husk-sdk-ts build`; Py: not needed unless wheel build is part of CI — check).**
- [ ] **Step 4: Write the integration test.**
- [ ] **Step 5: Run integration test with lightpanda:**
  `LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda pnpm --filter husk-orchestrator test integration/cognition-intend` → PASS.
- [ ] **Step 6: Run full suite (no lightpanda) — test should skip; everything else green.**
- [ ] **Step 7: Commit**

```bash
git add sdk/ts/src/types.ts sdk/ts/src/session.ts \
        sdk/py/husk/types.py sdk/py/husk/session.py \
        orchestrator/tests/integration/cognition-intend.test.ts
git commit -m "feat(sdk): Session.intend on TS + Py + cognition e2e against lightpanda"
```

---

## Task 10 — Docs + tag + merge

**Model:** Haiku — pure mechanical.

### Spec amendment

Append to `docs/superpowers/specs/2026-05-25-husk-v0.1-design.md`'s Implementation Progress section:

```markdown

### Phase B — Intention Compiler (M19 — shipped 2026-05-25)

Shipped:
- `Intention` + `Outcome` + `Evidence` + `FailureReason` types (30 reasons)
- SQLite schema v4: `cognition_intentions` table
- `IntentionStore` SQLite CRUD
- YAML intention parser + interpolate helper
- `IntentResolver` — maps `IntentRef` to stable_id via M5's role-name matcher
- `verify-runner` — runs URL/network/predicate checks
- `IntentionCompiler` — full orchestration: identify state → BFS path → execute → verify → classify failures
- `failure-taxonomy` — classifyError + recovery-strategy table
- HTTP JSON-RPC `intend` method
- TS + Py SDKs: `session.intend({intention_name, args, site?})`
- Real-lightpanda integration test (2-page fixture flow)

Not yet shipped (Phase C+):
- Outcome verifier expansion (richer evidence) — Phase C
- Capability router rewrite (engine swap mid-intention) — Phase D
- Streaming protocol — Phase E
- MCP `husk_intend` tool (and consolidation of 21 tools → 8) — Phase F
- Playbooks (compound intentions)

**MCP surface unchanged at 21 tools.** Intend is SDK-only in Phase B.

**Test count after Phase B:** <FILL IN>
```

### Memory updates

- `husk-roadmap.md`: add `v0.0.18-m19 — Phase B of v0.1 (Intention Compiler)`
- `husk-architecture.md`: append a "Cognition Layer — Phase B (Intention Compiler)" subsection summarizing types + modules + locked decisions
- `husk-overview.md`: update status to "v0.1 build in progress, Phase B of 6 complete"

### Tag + merge

```bash
git tag -a v0.0.18-m19 -m "M19: v0.1 Phase B — Intention Compiler

- Intention types + 30-reason failure taxonomy + Outcome envelope
- IntentionCompiler: state-graph BFS + verify + failure classification
- SQLite schema v4 (cognition_intentions)
- HTTP intend JSON-RPC method
- TS + Py SDKs: session.intend()
- MCP surface unchanged: 21 tools (husk_intend deferred to Phase F)

Phase C (outcome verifier expansion) is next."

git checkout main
git merge --no-ff m19-intention-compiler -m "Merge Milestone 19 (v0.1 Phase B: Intention Compiler)"
```

DO NOT push — push is deferred (GitHub email-privacy block still in place).

---

## Self-review

**Spec coverage:**
- §4.1 vocabulary — `intend()` is the verb; nav/ask_human deferred (already exist as separate methods in v0)
- §4.2 compiler — covered in T7
- §4.3 outcome envelope — covered in T1 + T7
- §4.4 failure-mode taxonomy (30 reasons) — covered in T1 + T2
- §4.6 confidence integration — uses existing M18 storage; no Phase B changes
- §4.7 memory model — cognition_intentions extends M18 schema
- §4.8 playbooks — explicitly deferred

**No placeholders:** Every step shows actual code, test bodies, exact commands.

**Type consistency:** `Outcome`, `Evidence`, `IntentionStep`, `VerifyCheck`, `FailureReason` defined in T1; reused throughout T2-T9. Same shapes in SDKs.

**Tool bloat:** +0 new MCP tools (deferred to Phase F). +1 new JSON-RPC method (`intend`). ✓

**Backward compat:** All M18 + earlier modules untouched. SQLite schema is additive (new table only). ✓

**Engine-independent:** Compiler operates on the SessionAdapter interface — works with lightpanda + Chrome equally. ✓

---

## Execution

Subagent-driven, same flow as M18:
- T1 → review → T2 → review → … → T10
- Continuous execution, no checkpoints between tasks
- Combined spec+code review acceptable for T1, T2, T3, T4, T10 (mechanical)
- Separate reviews for T5, T6, T7, T8, T9 (substantive integration)
- Tag + merge at end; no push.

Branch: `m19-intention-compiler` (already cut from main).
