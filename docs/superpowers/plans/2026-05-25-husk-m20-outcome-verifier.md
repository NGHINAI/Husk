# Husk M20 — Phase C: Outcome Verifier Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Eliminate verify-check race conditions and improve evidence debuggability. Polling-with-timeout is the load-bearing addition — real browsers race action and post-state, so single-shot verify is inherently flaky. Two convenience check types (`text_present`, `text_absent`) and Evidence enrichment (`ts`, `source`) round out the phase.

**Architecture:** Phase C extends Phase B's verify-runner without touching the compiler's overall orchestration. New: `runVerifyWithRetry(check, ctx, {timeout_ms, interval_ms})`. The compiler uses retry by default when a check declares `retry: {timeout_ms, interval_ms?}`. Existing single-shot semantics remain the default — additive only, fully backward compatible with Phase B intentions.

**Tech Stack:** TypeScript orchestrator only. No new dependencies. SDK mirrors the new types.

**Locked decisions honored (v0.1 spec §16):**
- LLM-neutral — pure deterministic check evaluation
- Conservative trust — every retry exhaustion returns `verify_failed` with all attempt timestamps in evidence
- Outcome envelope contract unchanged — Evidence gains optional fields; existing fields untouched

**Explicitly deferred (NOT in Phase C scope):**
- `ax_state` checks (button-disabled, checkbox-checked) — requires AxTreeNode shape extension in the snapshot pipeline; that's Phase D (Capability Router) work
- Observation-log integration (writing Evidence back to `cognition_observations`) — Phase D; requires schema extension
- Screenshot evidence — Phase E (streaming) where the watch UI can render frames
- Evidence weighting + intention-level confidence — Phase D
- Recovery options enriched with executable intention chains — Phase D

**Spec references:** v0.1 design doc §4.3 (Outcome envelope), §4.4 (failure modes).

---

## File Structure

### Modified files

```
orchestrator/src/cognition/intention-types.ts       # add text_present/text_absent VerifyCheck variants + Evidence enrichment + retry field
orchestrator/src/cognition/verify-runner.ts         # add text checkers + runVerifyWithRetry wrapper
orchestrator/src/cognition/intention-compiler.ts    # use runVerifyWithRetry when check declares retry
sdk-ts/src/types.ts                                 # mirror VerifyCheck + Evidence enrichment
sdk-py/husk/_types.py                               # mirror in Py
```

### New test files

```
orchestrator/tests/cognition/verify-runner-text.test.ts        # text_present/text_absent unit tests
orchestrator/tests/cognition/verify-runner-retry.test.ts       # polling wrapper unit tests
orchestrator/tests/cognition/intention-compiler-retry.test.ts  # compiler uses polling
orchestrator/tests/integration/cognition-verify-retry.test.ts  # real-lightpanda e2e for the polling path
```

---

## Task 1 — Type extensions (VerifyCheck + Evidence)

**Model:** Haiku — pure type additions + ensuring exhaustiveness compiles.

### Files

- Modify: `orchestrator/src/cognition/intention-types.ts`
- Test: `orchestrator/tests/cognition/intention-types.test.ts` (extend the existing T1 test from M19 with new shape assertions)

### Type changes

Add two new `VerifyCheck` variants and a `retry?` field on **all** variants. Enrich `Evidence`.

```typescript
// Replace the existing VerifyCheck union with:
export type VerifyCheck =
  | {
      type: "predicate";
      predicate: Predicate;
      description: string;
      retry?: RetryOptions;
    }
  | {
      type: "network";
      method?: "GET" | "POST" | "PUT" | "DELETE";
      url_pattern: string;
      status_min?: number;
      status_max?: number;
      description: string;
      retry?: RetryOptions;
    }
  | {
      type: "url";
      pattern: string;
      description: string;
      retry?: RetryOptions;
    }
  | {
      type: "text_present";
      /** Regex (case-insensitive by default) to match against collapsed text content. */
      pattern: string;
      description: string;
      retry?: RetryOptions;
    }
  | {
      type: "text_absent";
      /** Regex (case-insensitive by default). Passes when the pattern is NOT found. */
      pattern: string;
      description: string;
      retry?: RetryOptions;
    };

/** Retry policy for a verify check. */
export interface RetryOptions {
  /** Total budget (default 5000). */
  timeout_ms?: number;
  /** Wait between attempts (default 250). */
  interval_ms?: number;
  /** Hard cap on attempts regardless of timeout (default 20). */
  max_attempts?: number;
}

// Replace Evidence with:
export interface Evidence {
  predicate: string;
  passed: boolean;
  observed_value?: unknown;
  /** Unix ms when this check ran (or the last attempt if polled). */
  ts?: number;
  /** Where the data came from: which subsystem produced it. */
  source?: "url" | "network" | "ax" | "predicate" | "text";
  /** Severity tag — defaults to "block" for hard verify; "warn" for softer signals. */
  severity?: "info" | "warn" | "block";
  /** When retrying, how many attempts were made. Absent for single-shot. */
  attempts?: number;
}
```

### Tests to add (in existing intention-types.test.ts)

Append to the existing describe block:

```typescript
it("VerifyCheck supports text_present and text_absent", () => {
  const checks: VerifyCheck[] = [
    { type: "text_present", pattern: "Success", description: "shows success" },
    { type: "text_absent", pattern: "Error", description: "no error" },
  ];
  expect(checks).toHaveLength(2);
});

it("VerifyCheck supports retry options on all types", () => {
  const c: VerifyCheck = {
    type: "url",
    pattern: "/done",
    description: "wait for /done",
    retry: { timeout_ms: 3000, interval_ms: 200, max_attempts: 15 },
  };
  expect(c.retry?.timeout_ms).toBe(3000);
});

it("Evidence carries optional ts, source, severity, attempts", () => {
  const e: Evidence = {
    predicate: "URL ends in /done",
    passed: true,
    ts: 1700000000000,
    source: "url",
    severity: "block",
    attempts: 3,
  };
  expect(e.attempts).toBe(3);
  expect(e.source).toBe("url");
});
```

### TDD steps

- [ ] **Step 1: Read existing intention-types.ts to confirm import structure.**
- [ ] **Step 2: Add the new tests above to intention-types.test.ts.**
- [ ] **Step 3: Run `pnpm --filter husk-orchestrator test cognition/intention-types` — expect FAIL (text_present, text_absent, RetryOptions, attempts not defined).**
- [ ] **Step 4: Update intention-types.ts with the new VerifyCheck union, `RetryOptions` interface, and enriched Evidence.**
- [ ] **Step 5: Re-run — expect PASS.**
- [ ] **Step 6: Verify Phase B's intention-compiler.ts still type-checks. The compiler uses `runVerify` and reads `Evidence.passed` — both still work because the new fields are optional. Run `pnpm --filter husk-orchestrator build` → expect clean.**
- [ ] **Step 7: Run full suite → 846 + 3 new tests = 849 passing.**
- [ ] **Step 8: Commit:**

```bash
git add orchestrator/src/cognition/intention-types.ts \
        orchestrator/tests/cognition/intention-types.test.ts
git commit -m "feat(cognition): VerifyCheck text variants + RetryOptions + enriched Evidence"
```

---

## Task 2 — text_present / text_absent checkers

**Model:** Haiku — pure logic, mirrors the predicate evaluator's existing text-collection helper.

### Files

- Modify: `orchestrator/src/cognition/verify-runner.ts`
- Create: `orchestrator/tests/cognition/verify-runner-text.test.ts`

### Implementation

Reuse the predicate evaluator's text-collection logic by reading `predicate.ts`'s `collectAllText(root)` helper. If it's not exported, either export it (one-line change to predicate.ts) OR duplicate the small walker inside verify-runner. Prefer the export — keeps text collection consistent across the cognition layer.

```typescript
// In verify-runner.ts, add a helper that collects text from the AX tree:
import { collectAllText } from "./predicate.js";

function evalTextPresent(check: VerifyCheck & { type: "text_present" | "text_absent" }, ctx: VerifyContext): Evidence {
  const text = collectAllText(ctx.snapshot.root);
  let passed = false;
  let observed: string | undefined;
  try {
    const re = new RegExp(check.pattern, "i");
    const match = re.exec(text);
    if (check.type === "text_present") {
      passed = match !== null;
      observed = match?.[0];
    } else {
      passed = match === null;
    }
  } catch {
    passed = false;
  }
  return {
    predicate: check.description,
    passed,
    observed_value: observed,
    ts: Date.now(),
    source: "text",
    severity: "block",
  };
}
```

Extend `runVerify`'s switch to call the new helper:

```typescript
if (check.type === "text_present" || check.type === "text_absent") {
  return evalTextPresent(check, ctx);
}
```

Also extend the **existing** url/network/predicate handlers to populate the new Evidence fields (`ts`, `source`):

```typescript
// url check evidence
return { predicate: check.description, passed, observed_value: ctx.currentUrl, ts: Date.now(), source: "url", severity: "block" };

// network check evidence
return { predicate: check.description, passed: match !== undefined, observed_value: match, ts: Date.now(), source: "network", severity: "block" };

// predicate check evidence
return { predicate: check.description, passed, ts: Date.now(), source: "predicate", severity: "block" };
```

### `predicate.ts` change

Export `collectAllText` (currently file-local):

```typescript
// In predicate.ts, change:
function collectAllText(root: AxTreeNode): string { ... }
// To:
export function collectAllText(root: AxTreeNode): string { ... }
```

### Tests (new file: verify-runner-text.test.ts)

```typescript
import { describe, it, expect } from "vitest";
import { runVerify } from "../../src/cognition/verify-runner.js";
import type { VerifyCheck, VerifyContext } from "../../src/cognition/verify-runner.js";
// import the AxTreeNode type if exported

const snap = (text: string) => ({
  url: "https://x.com/",
  snapshot: {
    url: "https://x.com/",
    root: {
      i: "r", r: "main", n: "",
      c: [
        { i: "a", r: "heading", n: text },
      ],
    },
  },
} as unknown as VerifyContext);

describe("verify-runner text checks", () => {
  it("text_present passes when pattern matches in AX tree text", () => {
    const check: VerifyCheck = { type: "text_present", pattern: "Welcome", description: "shows welcome" };
    const ev = runVerify(check, snap("Welcome to LinkedIn"));
    expect(ev.passed).toBe(true);
    expect(ev.observed_value).toBe("Welcome");
    expect(ev.source).toBe("text");
  });

  it("text_present is case-insensitive by default", () => {
    const check: VerifyCheck = { type: "text_present", pattern: "welcome", description: "shows welcome" };
    const ev = runVerify(check, snap("Welcome to LinkedIn"));
    expect(ev.passed).toBe(true);
  });

  it("text_present fails when pattern not in tree", () => {
    const check: VerifyCheck = { type: "text_present", pattern: "Error", description: "no error" };
    const ev = runVerify(check, snap("Welcome to LinkedIn"));
    expect(ev.passed).toBe(false);
  });

  it("text_absent passes when pattern is absent", () => {
    const check: VerifyCheck = { type: "text_absent", pattern: "Error", description: "no error visible" };
    const ev = runVerify(check, snap("Welcome to LinkedIn"));
    expect(ev.passed).toBe(true);
  });

  it("text_absent fails when pattern is present", () => {
    const check: VerifyCheck = { type: "text_absent", pattern: "Welcome", description: "no welcome" };
    const ev = runVerify(check, snap("Welcome to LinkedIn"));
    expect(ev.passed).toBe(false);
  });

  it("invalid regex returns passed:false rather than throwing", () => {
    const check: VerifyCheck = { type: "text_present", pattern: "[invalid(", description: "bad regex" };
    const ev = runVerify(check, snap("anything"));
    expect(ev.passed).toBe(false);
  });

  it("evidence carries ts + source", () => {
    const check: VerifyCheck = { type: "text_present", pattern: "X", description: "x" };
    const ev = runVerify(check, snap("X"));
    expect(ev.ts).toBeGreaterThan(0);
    expect(ev.source).toBe("text");
  });
});
```

Also update existing verify-runner.test.ts to assert that Evidence now carries `ts` and `source` for url/network/predicate paths — minimal additions, just `expect(ev.source).toBe("url")` etc. on existing tests.

### TDD steps

- [ ] **Step 1: Read predicate.ts to find collectAllText and confirm export change is safe (no callers depend on it being private).**
- [ ] **Step 2: Export collectAllText.**
- [ ] **Step 3: Write the new verify-runner-text.test.ts.**
- [ ] **Step 4: Update existing verify-runner.test.ts to assert ts/source on existing Evidence (add expectations, don't delete existing).**
- [ ] **Step 5: Run text tests → FAIL.**
- [ ] **Step 6: Update verify-runner.ts: import collectAllText, add evalTextPresent, extend runVerify switch, populate ts/source on all paths.**
- [ ] **Step 7: Re-run → PASS for text tests + existing url/network/predicate tests still pass.**
- [ ] **Step 8: Full suite green: 849 + 7 = 856 passing.**
- [ ] **Step 9: Build clean.**
- [ ] **Step 10: Commit:**

```bash
git add orchestrator/src/cognition/predicate.ts \
        orchestrator/src/cognition/verify-runner.ts \
        orchestrator/tests/cognition/verify-runner-text.test.ts \
        orchestrator/tests/cognition/verify-runner.test.ts
git commit -m "feat(cognition): text_present/text_absent verify checks + Evidence ts+source"
```

---

## Task 3 — Polling verify wrapper

**Model:** Sonnet — async retry loop with timeout/interval/attempts; load-bearing for Phase C.

### Files

- Modify: `orchestrator/src/cognition/verify-runner.ts` — add `runVerifyWithRetry`
- Create: `orchestrator/tests/cognition/verify-runner-retry.test.ts`

### Implementation

```typescript
// Default retry budget when a check declares retry: {} with no fields.
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_INTERVAL_MS = 250;
const DEFAULT_MAX_ATTEMPTS = 20;

/**
 * Run a verify check with retry-until-pass semantics.
 *
 * Continues polling until any of:
 *   - the check passes (returns the passing Evidence with attempts counter)
 *   - timeout_ms elapsed
 *   - max_attempts reached
 *
 * The contextFactory is called fresh each attempt — pass a function that
 * re-snapshots / re-collects network state so polling sees the latest data.
 */
export async function runVerifyWithRetry(
  check: VerifyCheck,
  contextFactory: () => Promise<VerifyContext>,
  options?: RetryOptions,
): Promise<Evidence> {
  const retryConfig = check.retry ?? options;
  if (!retryConfig) {
    // No retry policy — fall back to single-shot.
    const ctx = await contextFactory();
    return runVerify(check, ctx);
  }
  const timeout = retryConfig.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const interval = retryConfig.interval_ms ?? DEFAULT_INTERVAL_MS;
  const maxAttempts = retryConfig.max_attempts ?? DEFAULT_MAX_ATTEMPTS;

  const start = Date.now();
  let attempts = 0;
  let lastEv: Evidence | null = null;

  while (true) {
    attempts++;
    const ctx = await contextFactory();
    const ev = runVerify(check, ctx);
    lastEv = ev;
    if (ev.passed) {
      return { ...ev, attempts, ts: Date.now() };
    }
    if (attempts >= maxAttempts) break;
    if (Date.now() - start + interval >= timeout) break;
    await sleep(interval);
  }
  // Exhausted: return last result with attempts annotation.
  return { ...(lastEv as Evidence), attempts, ts: Date.now() };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

Also export a convenience `runAllVerifyWithRetry` that maps over a list of checks:

```typescript
export async function runAllVerifyWithRetry(
  checks: VerifyCheck[],
  contextFactory: () => Promise<VerifyContext>,
): Promise<Evidence[]> {
  const evidence: Evidence[] = [];
  for (const c of checks) {
    evidence.push(await runVerifyWithRetry(c, contextFactory));
  }
  return evidence;
}
```

### Tests (verify-runner-retry.test.ts)

```typescript
import { describe, it, expect, vi } from "vitest";
import { runVerifyWithRetry } from "../../src/cognition/verify-runner.js";
import type { VerifyCheck, VerifyContext } from "../../src/cognition/verify-runner.js";

const stubCtx = (url: string): VerifyContext => ({
  currentUrl: url,
  snapshot: { url, root: { i: "r", r: "main", n: "" } } as any,
});

describe("runVerifyWithRetry", () => {
  it("returns immediately when no retry policy", async () => {
    const check: VerifyCheck = { type: "url", pattern: "/done", description: "wait" };
    const factory = vi.fn(async () => stubCtx("https://x/done"));
    const ev = await runVerifyWithRetry(check, factory);
    expect(ev.passed).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ev.attempts).toBeUndefined();
  });

  it("polls until the check passes", async () => {
    let attempts = 0;
    const factory = vi.fn(async () => {
      attempts++;
      return stubCtx(attempts < 3 ? "https://x/loading" : "https://x/done");
    });
    const check: VerifyCheck = {
      type: "url", pattern: "/done", description: "wait",
      retry: { timeout_ms: 2000, interval_ms: 10 },
    };
    const ev = await runVerifyWithRetry(check, factory);
    expect(ev.passed).toBe(true);
    expect(ev.attempts).toBe(3);
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it("returns failure after timeout", async () => {
    const factory = vi.fn(async () => stubCtx("https://x/loading"));
    const check: VerifyCheck = {
      type: "url", pattern: "/done", description: "wait",
      retry: { timeout_ms: 50, interval_ms: 10 },
    };
    const ev = await runVerifyWithRetry(check, factory);
    expect(ev.passed).toBe(false);
    expect(ev.attempts).toBeGreaterThan(0);
  });

  it("respects max_attempts", async () => {
    const factory = vi.fn(async () => stubCtx("https://x/loading"));
    const check: VerifyCheck = {
      type: "url", pattern: "/done", description: "wait",
      retry: { timeout_ms: 60000, interval_ms: 1, max_attempts: 5 },
    };
    const ev = await runVerifyWithRetry(check, factory);
    expect(ev.passed).toBe(false);
    expect(ev.attempts).toBe(5);
    expect(factory).toHaveBeenCalledTimes(5);
  });

  it("uses retry options arg when check has none", async () => {
    let calls = 0;
    const factory = vi.fn(async () => {
      calls++;
      return stubCtx(calls < 2 ? "https://x/loading" : "https://x/done");
    });
    const check: VerifyCheck = { type: "url", pattern: "/done", description: "wait" };  // no retry on check
    const ev = await runVerifyWithRetry(check, factory, { timeout_ms: 1000, interval_ms: 10 });
    expect(ev.passed).toBe(true);
    expect(ev.attempts).toBe(2);
  });

  it("re-fetches context fresh each attempt (does not cache)", async () => {
    const factory = vi.fn(async () => stubCtx("https://x/loading"));
    const check: VerifyCheck = {
      type: "url", pattern: "/done", description: "wait",
      retry: { timeout_ms: 100, interval_ms: 10 },
    };
    await runVerifyWithRetry(check, factory);
    expect(factory).toHaveBeenCalled();
    expect(factory.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
```

### TDD steps

- [ ] **Step 1: Write tests** → FAIL.
- [ ] **Step 2: Add `runVerifyWithRetry` + `runAllVerifyWithRetry` to verify-runner.ts.**
- [ ] **Step 3: Re-run → PASS (6/6).**
- [ ] **Step 4: Full suite green: 856 + 6 = 862.**
- [ ] **Step 5: Build clean.**
- [ ] **Step 6: Commit:**

```bash
git add orchestrator/src/cognition/verify-runner.ts \
        orchestrator/tests/cognition/verify-runner-retry.test.ts
git commit -m "feat(cognition): runVerifyWithRetry — polling verify with timeout/interval"
```

---

## Task 4 — Compiler integration (use retry by default)

**Model:** Sonnet — modify IntentionCompiler to call `runAllVerifyWithRetry` instead of single-shot `runAllVerify` when any check has a `retry` policy.

### Files

- Modify: `orchestrator/src/cognition/intention-compiler.ts`
- Create: `orchestrator/tests/cognition/intention-compiler-retry.test.ts`

### Behavior

When the compiler reaches the verify phase (step 4 in §"Design" of Phase B plan), it should:

1. If ANY check in `intention.verify` has `retry`, use `runAllVerifyWithRetry`. Otherwise use the single-shot `runAllVerify` (no behavior change for Phase B intentions).
2. Build a `contextFactory: () => Promise<VerifyContext>` closure that re-snapshots each call. The compiler already has access to the SessionAdapter; the factory just calls `adapter.snapshot()` + `adapter.currentUrl()` + `adapter.recentNetwork()`.
3. Same for the failure_modes check loop — each failure_mode.match should also use retry when set (so e.g. `failure_modes: [{reason: "bot_challenge", match: {type: "text_present", pattern: "Unusual activity", retry: {timeout_ms: 1000}}}]` polls for the challenge text to appear before deciding it's NOT a bot challenge).

### Code change sketch

```typescript
// In intention-compiler.ts execute(), replace the verify block:

// Existing (Phase B):
//   const evidence = runAllVerify(intention.verify, verifyCtx);

// New:
const verifyCtxFactory = async (): Promise<VerifyContext> => {
  const fresh = await session.snapshot();
  return {
    currentUrl: session.currentUrl(),
    snapshot: this.adapt(fresh, session.currentUrl()),
    network: session.recentNetwork(),
  };
};
const hasRetry = intention.verify.some((c) => c.retry !== undefined);
const evidence = hasRetry
  ? await runAllVerifyWithRetry(intention.verify, verifyCtxFactory)
  : runAllVerify(intention.verify, await verifyCtxFactory());
```

For the failure_modes check loop:

```typescript
for (const fm of intention.failure_modes) {
  const ev = fm.match.retry
    ? await runVerifyWithRetry(fm.match, verifyCtxFactory)
    : runVerify(fm.match, await verifyCtxFactory());
  if (ev.passed) {
    return this.failOutcome(...);
  }
}
```

Be careful: avoid calling `verifyCtxFactory()` more times than needed when no retry is set — the original Phase B path snapshotted once for all verify+failure_mode evaluation. Preserve that efficiency: capture one ctx upfront for the no-retry case, factory-based for the retry case.

### Tests (intention-compiler-retry.test.ts)

```typescript
import { describe, it, expect, vi } from "vitest";
import { IntentionCompiler, type SessionAdapter } from "../../src/cognition/intention-compiler.js";
import { StateGraph } from "../../src/cognition/state-graph.js";
import type { Intention } from "../../src/cognition/intention-types.js";

function makeAdapter(snaps: any[]): SessionAdapter {
  let i = 0;
  const next = () => snaps[Math.min(i++, snaps.length - 1)];
  return {
    currentUrl: vi.fn(() => "https://test.com/" + (snaps[Math.min(i, snaps.length - 1)]?.urlPath ?? "x")) as any,
    snapshot: vi.fn(async () => next()) as any,
    click: vi.fn(async () => {}) as any,
    type: vi.fn(async () => {}) as any,
    pressKey: vi.fn(async () => {}) as any,
    scroll: vi.fn(async () => {}) as any,
    navigate: vi.fn(async () => {}) as any,
    recentNetwork: vi.fn(() => []) as any,
  };
}

const homeState = () => ({
  site: "test.com",
  state_id: "home",
  identify_by: { type: "url_pattern", regex: "/" },
  affordances: [],
  observed_count: 1,
  confidence: 0.9,
  last_seen_at: 0,
});

describe("IntentionCompiler retry integration", () => {
  it("uses polling when any verify check has retry", async () => {
    const graph = new StateGraph("test.com", new Map([["home", homeState() as any]]), []);
    const compiler = new IntentionCompiler({ graph, site: "test.com" });

    // First two snapshots show "loading", third shows "done".
    const snaps = [
      { url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"", c:[{i:"h",r:"heading",n:"Loading"}] } },
      { url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"", c:[{i:"h",r:"heading",n:"Loading"}] } },
      { url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"", c:[{i:"h",r:"heading",n:"Done"}] } },
    ];
    const adapter = makeAdapter(snaps);

    const intention: Intention = {
      site: "test.com", name: "wait_done", args_schema: {},
      steps: [],
      verify: [
        { type: "text_present", pattern: "Done", description: "shows done",
          retry: { timeout_ms: 500, interval_ms: 5 } },
      ],
      failure_modes: [],
      created_at: 0, updated_at: 0,
    };

    const outcome = await compiler.execute(adapter, intention, {});
    expect(outcome.ok).toBe(true);
    expect(outcome.evidence[0].passed).toBe(true);
    expect(outcome.evidence[0].attempts).toBeGreaterThanOrEqual(2);
  });

  it("single-shot when no check has retry (preserves Phase B behavior)", async () => {
    const graph = new StateGraph("test.com", new Map([["home", homeState() as any]]), []);
    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const snaps = [{ url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"" } }];
    const adapter = makeAdapter(snaps);
    const intention: Intention = {
      site: "test.com", name: "x", args_schema: {},
      steps: [],
      verify: [{ type: "url", pattern: "/", description: "still on root" }],
      failure_modes: [],
      created_at: 0, updated_at: 0,
    };
    await compiler.execute(adapter, intention, {});
    // snapshot called: once before execution + once for verify-ctx = 2 expected (not polling)
    expect((adapter.snapshot as any).mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("returns verify_failed after timeout when condition never reached", async () => {
    const graph = new StateGraph("test.com", new Map([["home", homeState() as any]]), []);
    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    const snaps = [{ url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"" } }];
    const adapter = makeAdapter(snaps);
    const intention: Intention = {
      site: "test.com", name: "x", args_schema: {},
      steps: [],
      verify: [{
        type: "text_present", pattern: "ImpossibleString", description: "never appears",
        retry: { timeout_ms: 30, interval_ms: 5 },
      }],
      failure_modes: [],
      created_at: 0, updated_at: 0,
    };
    const outcome = await compiler.execute(adapter, intention, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("verify_failed");
    expect(outcome.evidence[0].attempts).toBeGreaterThan(1);
  });

  it("failure_mode with retry polls before classifying", async () => {
    const graph = new StateGraph("test.com", new Map([["home", homeState() as any]]), []);
    const compiler = new IntentionCompiler({ graph, site: "test.com" });
    // Snapshots show the bot-challenge text appearing after a delay
    const snaps = [
      { url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"" } },
      { url: "https://test.com/", urlPath: "", root: { i:"r", r:"main", n:"", c:[{i:"t",r:"heading",n:"Unusual activity"}] } },
    ];
    const adapter = makeAdapter(snaps);
    const intention: Intention = {
      site: "test.com", name: "x", args_schema: {},
      steps: [],
      verify: [{ type: "url", pattern: "/", description: "any" }],
      failure_modes: [{
        reason: "bot_challenge",
        match: { type: "text_present", pattern: "Unusual activity", description: "bot challenge",
                 retry: { timeout_ms: 100, interval_ms: 5 } },
      }],
      created_at: 0, updated_at: 0,
    };
    const outcome = await compiler.execute(adapter, intention, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("bot_challenge");
  });
});
```

### TDD steps

- [ ] **Step 1: Read intention-compiler.ts to identify the verify + failure_mode blocks.**
- [ ] **Step 2: Write the new tests above** → FAIL.
- [ ] **Step 3: Modify intention-compiler.ts: build verifyCtxFactory closure; route to retry-aware functions when any check has retry.**
- [ ] **Step 4: Verify the existing intention-compiler.test.ts still passes — no behavior change for non-retry intentions.**
- [ ] **Step 5: Re-run all compiler tests** → expect PASS.
- [ ] **Step 6: Full suite green: 862 + 4 = 866.**
- [ ] **Step 7: Build clean.**
- [ ] **Step 8: Commit:**

```bash
git add orchestrator/src/cognition/intention-compiler.ts \
        orchestrator/tests/cognition/intention-compiler-retry.test.ts
git commit -m "feat(cognition): compiler uses polling when verify checks declare retry"
```

---

## Task 5 — Real-lightpanda integration test + SDK type mirrors

**Model:** Sonnet — extends both SDKs minimally + writes the e2e.

### Files

- Modify: `sdk-ts/src/types.ts` — mirror new VerifyCheck variants + RetryOptions + Evidence enrichment
- Modify: `sdk-py/husk/_types.py` — mirror in Py
- Create: `orchestrator/tests/integration/cognition-verify-retry.test.ts`

### SDK changes

In `sdk-ts/src/types.ts`, extend the Evidence interface and (optionally) export the VerifyCheck variants if they're surfaced. **Note:** SDKs may not expose VerifyCheck at all — intention authoring is server-side (YAML in the cognition tables). If `VerifyCheck` is not currently in the SDK, skip exporting it. Just enrich `Evidence`:

```typescript
export interface Evidence {
  predicate: string;
  passed: boolean;
  observed_value?: unknown;
  ts?: number;
  source?: "url" | "network" | "ax" | "predicate" | "text";
  severity?: "info" | "warn" | "block";
  attempts?: number;
}
```

In `sdk-py/husk/_types.py`:

```python
@dataclass
class Evidence:
    predicate: str
    passed: bool
    observed_value: Any = None
    ts: Optional[int] = None
    source: Optional[Literal["url", "network", "ax", "predicate", "text"]] = None
    severity: Optional[Literal["info", "warn", "block"]] = None
    attempts: Optional[int] = None
```

And update `Evidence.from_json` / the Outcome `from_json` to populate these (forward-compatible — missing fields default to None).

### Integration test (cognition-verify-retry.test.ts)

Pattern-match `cognition-intend.test.ts` (M19 T9). Set up a fixture server with:
- `GET /slow-page` — returns HTML where a heading "Loading" is replaced by "Done" after a setTimeout. (Lightpanda may not run setTimeout reliably; if so, use a sequence of two routes: first GET returns "Loading", subsequent GETs return "Done" — track via a flag on the server.)

Easier and more reliable: use **two routes** — `/loading` returns "Loading" page; `/done` returns "Done" page; the intention navigates to /loading first, then has a verify with retry that succeeds after the test code separately navigates to /done after a short delay.

OR even simpler: use the fact that lightpanda's snapshot is somewhat stable post-load. Test with a SHORT polling intention that *fails* — proves the polling path executes — combined with one that *passes immediately* — proves the no-retry shortcut works. The "transitions from failing to passing over time" test is the unit test in T4; the e2e proves the wire path under real lightpanda.

```typescript
// orchestrator/tests/integration/cognition-verify-retry.test.ts
// Use locateLightpanda + describe.skip pattern from cognition-intend.test.ts

// Test 1: polling verify times out → outcome.ok=false, reason=verify_failed, evidence has attempts > 1
// Test 2: text_present verify against the actual page content → outcome.ok=true
//   (e.g. fixture serves <h1>Welcome</h1>; intention has verify: [{type:"text_present", pattern:"Welcome"}])
// Test 3: text_absent verify → outcome.ok=true when the bad string isn't present
```

### TDD steps

- [ ] **Step 1: Read existing SDK Evidence definitions (TS + Py) to confirm starting point.**
- [ ] **Step 2: Update SDK types** — add optional fields. From-JSON deserializers don't need explicit handling because they're optional (use `.get(key)`).
- [ ] **Step 3: Write integration test** with 3 test cases.
- [ ] **Step 4: Build orchestrator:** `pnpm --filter husk-orchestrator build` → clean.
- [ ] **Step 5: Run integration test with lightpanda:**
  `LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda pnpm --filter husk-orchestrator test integration/cognition-verify-retry`
  Expect: 3 PASS.
- [ ] **Step 6: Run full suite without lightpanda — test skips cleanly; no regression. Expected: 866 passing.**
- [ ] **Step 7: Commit:**

```bash
git add sdk-ts/src/types.ts sdk-py/husk/_types.py \
        orchestrator/tests/integration/cognition-verify-retry.test.ts
git commit -m "feat(sdk): Evidence enrichment + cognition verify-retry e2e against lightpanda"
```

---

## Task 6 — Docs + memory + tag + merge

**Model:** Haiku — pure mechanical.

### Spec amendment

Append to `docs/superpowers/specs/2026-05-25-husk-v0.1-design.md`'s Implementation Progress section (after the M19 Phase B block):

```markdown

### Phase C — Outcome Verifier Expansion (M20 — shipped 2026-05-25)

Shipped:
- New `VerifyCheck` variants: `text_present`, `text_absent` (regex over collapsed AX text)
- `RetryOptions` (timeout_ms, interval_ms, max_attempts) on every VerifyCheck variant
- `runVerifyWithRetry(check, contextFactory, options?)` — async polling wrapper
- `runAllVerifyWithRetry(checks, contextFactory)` convenience helper
- `IntentionCompiler` integration — uses polling when any check declares retry; also applies retry to `failure_modes.match` patterns
- Enriched `Evidence` — added `ts`, `source` (url|network|ax|predicate|text), `severity` (info|warn|block), `attempts` (count of polling attempts)
- SDK type mirrors (TS + Py) for enriched Evidence
- Real-lightpanda integration test (polling-pass, polling-timeout, text_present, text_absent)

Backward compatibility: All Phase B intentions work unchanged. Single-shot verify is the default; retry is opt-in per check.

Explicitly deferred (Phase D+):
- `ax_state` checks (button-disabled, checkbox-checked, etc.) — requires AxTreeNode shape extension in the snapshot pipeline; bundled with Phase D capability router work
- Observation-log integration (Evidence → `cognition_observations`) — Phase D; requires schema extension
- Screenshot evidence — Phase E (streaming)
- Evidence weighting + intention confidence scoring — Phase D
- Compound recovery options (executable intention chains) — Phase D

**MCP surface unchanged at 21 tools.** Phase C is internal cognition-layer work only.

**Test count after Phase C:** ~866 passing (without LIGHTPANDA_BIN), +3 e2e when lightpanda is available.
```

### Memory updates

- `husk-roadmap.md`: add `v0.0.19-m20 — Phase C of v0.1 (Outcome Verifier Expansion)`
- `husk-architecture.md`: append "Cognition Layer — Phase C (Outcome Verifier Expansion)" subsection summarizing the polling primitive + new check types
- `husk-overview.md`: update status to "v0.1 build in progress, Phase C of 6 complete"

### Tag + merge

```bash
git tag -a v0.0.19-m20 -m "M20: v0.1 Phase C — Outcome Verifier Expansion

- Polling verify: runVerifyWithRetry with timeout/interval/max_attempts
- New check types: text_present, text_absent
- Enriched Evidence: ts + source + severity + attempts
- IntentionCompiler uses polling when checks declare retry
- SDK mirror updates (TS + Py)
- MCP surface unchanged: 21 tools

Phase D (capability router rewrite + ax_state checks) is next."

git checkout main
git merge --no-ff m20-outcome-verifier -m "Merge Milestone 20 (v0.1 Phase C: Outcome Verifier Expansion)"
```

DO NOT push.

---

## Self-review

**Spec coverage:**
- §4.3 Evidence enrichment ✓
- §4.3 verify check expansion ✓ (text_present, text_absent)
- §4.4 failure-modes polling ✓
- Race-resilience ✓ (the load-bearing addition)
- Deferred items documented ✓

**No placeholders:** Each step shows actual code, test bodies, exact commands.

**Type consistency:** RetryOptions is referenced from all VerifyCheck variants; Evidence enrichment is purely additive (all fields optional).

**Tool bloat:** +0 new MCP tools, +0 new JSON-RPC methods. ✓

**Backward compat:** Phase B intentions work unchanged. Single-shot is the default; retry is opt-in. ✓

**Engine independence:** Polling works against any SessionAdapter implementation (lightpanda + Chrome). ✓

---

## Execution

Subagent-driven:
- T1 → T2 → T3 → T4 → T5 → T6, fresh subagent per task
- Combined spec+code review for T1, T2, T6 (mechanical)
- Separate spec then code review for T3, T4, T5 (substantive)
- Continuous execution; no checkpoints between tasks
- Tag + merge at end; no push.

Branch: `m20-outcome-verifier` (already cut from main).
