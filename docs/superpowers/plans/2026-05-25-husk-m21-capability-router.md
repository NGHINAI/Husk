# Husk M21 — Phase D: Capability Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace M17's engine-kind dispatch (`engine: "lightpanda" | "chrome" | "auto"`) with capability-based routing (tasks declare what they need; router picks the best engine). Bring home Phase B/C deferred items: surface AX state on `AxTreeNode`, ship `ax_state` verify check, integrate Evidence into the observation log.

**Architecture:** Two new orthogonal subsystems:
1. **Capability layer** — `CapabilityRequirement` (what an intention/session needs) + `EngineCapabilities` (what each engine can do) + capability-aware router that scores engines against requirements
2. **AX-state surfacing** — extend `AxTreeNode` with optional `s` (state) field populated from CDP Accessibility properties; `ax_state` verify check evaluates it

Mid-intention engine swap is the load-bearing piece — generalizes M17's startup-time fallback into runtime engine reassignment when the current engine fails a capability check mid-execution. Observation-log integration writes Evidence back to `cognition_observations` for future confidence learning.

**Tech Stack:** TypeScript orchestrator only. No new dependencies.

**Locked decisions honored (v0.1 spec §16):**
- Capability declarations are static metadata (no LLM)
- Router algorithm is deterministic scoring; ties broken by lowest-cost engine
- Backward-compatible: existing `engine: "auto"|"chrome"|"lightpanda"` keeps working; capabilities are additive

**Explicitly deferred (NOT Phase D scope):**
- "real-user" engine (third option in the spec) — needs a Watch-UI / paste-handoff pipeline that's Phase E (streaming)
- Evidence weighting + intention confidence scoring — saved for a polish milestone
- Compound recovery options (executable intention chains) — Phase F (tool consolidation) — when recovery options become real intentions

**Spec references:** v0.1 design doc §3 (capability router), §4.4 (failure modes), §4.6 (confidence integration), §4.7 (memory model).

---

## File Structure

### New files

```
orchestrator/src/engine/
  capability-types.ts        # EngineCapabilities, CapabilityRequirement, scoring types
  engine-capabilities.ts     # Static capability fingerprints for lightpanda + chrome
  capability-router.ts       # match(requirement, engines) → ranked candidates

orchestrator/src/cognition/
  ax-state.ts                # ax_state verify check evaluator
  observation-link.ts        # writes Evidence rows back to cognition_observations
```

### Modified files

```
orchestrator/src/cognition/predicate.ts            # extend AxTreeNode with `s?` (state) field
orchestrator/src/cognition/intention-types.ts      # CapabilityRequirement on Intention; ax_state VerifyCheck variant
orchestrator/src/cognition/verify-runner.ts        # dispatch ax_state
orchestrator/src/cognition/intention-compiler.ts   # request capability-aware engine at start + on mid-intention failure; write Evidence to observation log
orchestrator/src/engine/engine-router.ts           # add acquireForCapability() alongside existing acquire(kind, …)
orchestrator/src/session/snapshot.ts (or wherever AX is built)  # populate AxTreeNode.s from CDP properties
orchestrator/src/cache/schema.ts                   # bump SCHEMA_VERSION 4→5: add evidence_json column to cognition_observations
orchestrator/src/cognition/storage.ts              # extend recordObservation to accept evidence
sdk-ts/src/types.ts                                # mirror CapabilityRequirement (optional in Outcome.args echoes)
sdk-py/husk/_types.py                              # mirror in Py
```

### Test files

```
orchestrator/tests/engine/capability-types.test.ts
orchestrator/tests/engine/engine-capabilities.test.ts
orchestrator/tests/engine/capability-router.test.ts
orchestrator/tests/cognition/ax-state.test.ts
orchestrator/tests/cognition/ax-tree-state.test.ts          # AxTreeNode `s?` field structural test
orchestrator/tests/cognition/observation-link.test.ts
orchestrator/tests/cognition/intention-compiler-cap.test.ts # mid-intention engine swap
orchestrator/tests/integration/cognition-capability.test.ts # real-lightpanda + chrome e2e
```

---

## Task 1 — Capability types + engine fingerprints

**Model:** Haiku — pure data + types.

### Files

- Create: `orchestrator/src/engine/capability-types.ts`
- Create: `orchestrator/src/engine/engine-capabilities.ts`
- Create: `orchestrator/tests/engine/capability-types.test.ts`
- Create: `orchestrator/tests/engine/engine-capabilities.test.ts`

### capability-types.ts

```typescript
/**
 * Capability layer for Husk v0.1 Phase D.
 *
 * Intentions / sessions declare what they need; engines declare what they offer.
 * The router scores each engine against requirements and picks the best match.
 */

/** JS execution level offered (or required). */
export type JsLevel = "none" | "basic" | "full";

/** Latency class — coarse-grained ranking for tie-breaking. */
export type LatencyClass = "fast" | "medium" | "slow";

/** A feature flag — open enum so site-specific needs can extend it. */
export type FeatureFlag =
  | "webrtc"
  | "service_worker"
  | "webassembly"
  | "shadow_dom_v1"
  | "complex_forms"
  | "media_playback"
  | "file_upload"
  | "websocket"
  | string;

/** What an intention or session declares it needs from an engine. */
export interface CapabilityRequirement {
  /** Minimum JS execution level. Defaults to "basic" when omitted. */
  js?: JsLevel;
  /** Feature flags the task requires. Defaults to []. */
  features?: FeatureFlag[];
  /** Domains the engine must already have authenticated session cookies for. */
  cookies_for?: string[];
  /** Maximum acceptable latency class. Engines slower than this are rejected. */
  max_latency?: LatencyClass;
  /** Soft preference for engines on this list when scores tie. */
  prefer_engines?: string[];
}

/** What an engine offers. */
export interface EngineCapabilities {
  /** Identifier — matches the kind used by the engine-router (e.g. "lightpanda", "chrome"). */
  engine: string;
  /** Maximum JS level supported. */
  js: JsLevel;
  /** Feature flags supported. */
  features: FeatureFlag[];
  /** Typical latency class for cold action dispatch. */
  latency: LatencyClass;
  /** Rough cost score (relative). Cheaper engines preferred when capabilities match. */
  cost: number;
}

/** Score for a single engine against a requirement set. */
export interface CapabilityScore {
  engine: string;
  /** Hard-pass: meets all required capabilities. */
  meets: boolean;
  /** Tie-break score; only meaningful when meets=true. Higher is better. */
  score: number;
  /** When meets=false, the unmet constraints. */
  reasons?: string[];
}

const JS_RANK: Record<JsLevel, number> = { none: 0, basic: 1, full: 2 };
const LATENCY_RANK: Record<LatencyClass, number> = { fast: 0, medium: 1, slow: 2 };

/** Compare two js levels: returns true when `offered >= required`. */
export function meetsJs(offered: JsLevel, required: JsLevel): boolean {
  return JS_RANK[offered] >= JS_RANK[required];
}

/** Latency comparison: returns true when `offered <= max_latency`. */
export function meetsLatency(offered: LatencyClass, max: LatencyClass): boolean {
  return LATENCY_RANK[offered] <= LATENCY_RANK[max];
}
```

### engine-capabilities.ts

```typescript
import type { EngineCapabilities } from "./capability-types.js";

/** Lightpanda — Zig-based headless browser. Fast but JS-limited. */
export const LIGHTPANDA_CAPS: EngineCapabilities = {
  engine: "lightpanda",
  js: "basic",
  features: ["complex_forms"],
  latency: "fast",
  cost: 1,
};

/** Chrome (or Chromium) — full browser. Slower but feature-complete. */
export const CHROME_CAPS: EngineCapabilities = {
  engine: "chrome",
  js: "full",
  features: [
    "webrtc",
    "service_worker",
    "webassembly",
    "shadow_dom_v1",
    "complex_forms",
    "media_playback",
    "file_upload",
    "websocket",
  ],
  latency: "medium",
  cost: 10,
};

/** Registry of all known engines. */
export const ALL_ENGINES: EngineCapabilities[] = [LIGHTPANDA_CAPS, CHROME_CAPS];

/** Look up capabilities by engine kind. Returns null when unknown. */
export function findEngine(name: string): EngineCapabilities | null {
  return ALL_ENGINES.find((e) => e.engine === name) ?? null;
}
```

### Tests (capability-types.test.ts)

```typescript
import { describe, it, expect } from "vitest";
import { meetsJs, meetsLatency } from "../../src/engine/capability-types.js";

describe("capability-types helpers", () => {
  it("meetsJs: full >= basic >= none", () => {
    expect(meetsJs("full", "basic")).toBe(true);
    expect(meetsJs("basic", "basic")).toBe(true);
    expect(meetsJs("basic", "full")).toBe(false);
    expect(meetsJs("none", "basic")).toBe(false);
  });

  it("meetsLatency: fast satisfies medium and slow caps", () => {
    expect(meetsLatency("fast", "medium")).toBe(true);
    expect(meetsLatency("medium", "medium")).toBe(true);
    expect(meetsLatency("slow", "medium")).toBe(false);
    expect(meetsLatency("fast", "fast")).toBe(true);
  });
});
```

### Tests (engine-capabilities.test.ts)

```typescript
import { describe, it, expect } from "vitest";
import { LIGHTPANDA_CAPS, CHROME_CAPS, ALL_ENGINES, findEngine } from "../../src/engine/engine-capabilities.js";

describe("engine-capabilities registry", () => {
  it("lightpanda is basic JS, fast latency, low cost", () => {
    expect(LIGHTPANDA_CAPS.js).toBe("basic");
    expect(LIGHTPANDA_CAPS.latency).toBe("fast");
    expect(LIGHTPANDA_CAPS.cost).toBeLessThan(CHROME_CAPS.cost);
  });

  it("chrome is full JS, medium latency, higher cost", () => {
    expect(CHROME_CAPS.js).toBe("full");
    expect(CHROME_CAPS.features).toContain("webrtc");
    expect(CHROME_CAPS.features).toContain("service_worker");
  });

  it("ALL_ENGINES contains both lightpanda and chrome", () => {
    const names = ALL_ENGINES.map((e) => e.engine);
    expect(names).toContain("lightpanda");
    expect(names).toContain("chrome");
  });

  it("findEngine returns the right entry or null", () => {
    expect(findEngine("chrome")?.engine).toBe("chrome");
    expect(findEngine("nope")).toBeNull();
  });
});
```

### TDD steps

- [ ] **Step 1: Write the 2 test files first.** Run `pnpm --filter husk-orchestrator test engine/capability-types engine/engine-capabilities` → FAIL.
- [ ] **Step 2: Write capability-types.ts + engine-capabilities.ts per bodies above.**
- [ ] **Step 3: Re-run → expect PASS (4 + 4 = 8 tests).**
- [ ] **Step 4: Full suite green: 866 + 8 = 874 passing.**
- [ ] **Step 5: Build clean.**
- [ ] **Step 6: Commit:**

```bash
git add orchestrator/src/engine/capability-types.ts \
        orchestrator/src/engine/engine-capabilities.ts \
        orchestrator/tests/engine/capability-types.test.ts \
        orchestrator/tests/engine/engine-capabilities.test.ts
git commit -m "feat(engine): capability types + lightpanda/chrome fingerprints"
```

---

## Task 2 — Capability-aware router (matcher)

**Model:** Sonnet — score-based selector with deterministic tie-breaking.

### Files

- Create: `orchestrator/src/engine/capability-router.ts`
- Create: `orchestrator/tests/engine/capability-router.test.ts`

### Module body

```typescript
import type {
  CapabilityRequirement,
  EngineCapabilities,
  CapabilityScore,
} from "./capability-types.js";
import { meetsJs, meetsLatency } from "./capability-types.js";

/**
 * Score one engine against a capability requirement.
 *
 * meets = true iff:
 *  - engine.js >= required.js (default "basic")
 *  - engine.features ⊇ required.features
 *  - engine.latency ≤ required.max_latency (when set)
 * (cookies_for is checked by the caller against runtime cookie inventory — see capability-router caller.)
 *
 * Tie-break score: lower cost + matching prefer_engines + extra feature headroom.
 */
export function scoreEngine(
  engine: EngineCapabilities,
  req: CapabilityRequirement,
  cookieInventory?: Set<string>,
): CapabilityScore {
  const reasons: string[] = [];

  const requiredJs = req.js ?? "basic";
  if (!meetsJs(engine.js, requiredJs)) {
    reasons.push(`js: required ${requiredJs}, offered ${engine.js}`);
  }

  for (const feat of req.features ?? []) {
    if (!engine.features.includes(feat)) {
      reasons.push(`feature: missing ${feat}`);
    }
  }

  if (req.max_latency && !meetsLatency(engine.latency, req.max_latency)) {
    reasons.push(`latency: ${engine.latency} > ${req.max_latency}`);
  }

  for (const dom of req.cookies_for ?? []) {
    if (!cookieInventory || !cookieInventory.has(`${engine.engine}:${dom}`)) {
      reasons.push(`cookies: ${engine.engine} lacks session for ${dom}`);
    }
  }

  if (reasons.length > 0) {
    return { engine: engine.engine, meets: false, score: 0, reasons };
  }

  // Tie-break score (higher = better):
  //   -engine.cost (cheap wins)
  //   + prefer_engines bonus
  //   + small bonus for feature headroom over what's needed
  let score = -engine.cost;
  if (req.prefer_engines?.includes(engine.engine)) score += 100;
  const requiredFeatures = new Set(req.features ?? []);
  const extra = engine.features.filter((f) => !requiredFeatures.has(f)).length;
  score += extra * 0.1;

  return { engine: engine.engine, meets: true, score };
}

/**
 * Rank a list of engines against a requirement.
 * Returns all engines (meets and !meets), sorted by:
 *  1. meets=true first
 *  2. then by descending score
 *  3. then alphabetically (deterministic tie-break)
 */
export function rankEngines(
  engines: EngineCapabilities[],
  req: CapabilityRequirement,
  cookieInventory?: Set<string>,
): CapabilityScore[] {
  const scores = engines.map((e) => scoreEngine(e, req, cookieInventory));
  scores.sort((a, b) => {
    if (a.meets !== b.meets) return a.meets ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return a.engine.localeCompare(b.engine);
  });
  return scores;
}

/**
 * Pick the best matching engine for a requirement.
 * Returns the engine name or null when nothing passes the hard constraints.
 */
export function pickEngine(
  engines: EngineCapabilities[],
  req: CapabilityRequirement,
  cookieInventory?: Set<string>,
): string | null {
  const ranked = rankEngines(engines, req, cookieInventory);
  if (ranked.length === 0 || !ranked[0].meets) return null;
  return ranked[0].engine;
}
```

### Tests

```typescript
import { describe, it, expect } from "vitest";
import { scoreEngine, rankEngines, pickEngine } from "../../src/engine/capability-router.js";
import { LIGHTPANDA_CAPS, CHROME_CAPS, ALL_ENGINES } from "../../src/engine/engine-capabilities.js";

describe("scoreEngine", () => {
  it("lightpanda meets a basic-js requirement with no features", () => {
    const s = scoreEngine(LIGHTPANDA_CAPS, {});
    expect(s.meets).toBe(true);
    expect(s.reasons).toBeUndefined();
  });

  it("lightpanda fails a full-js requirement", () => {
    const s = scoreEngine(LIGHTPANDA_CAPS, { js: "full" });
    expect(s.meets).toBe(false);
    expect(s.reasons?.[0]).toMatch(/js/);
  });

  it("chrome meets webrtc + service_worker requirements", () => {
    const s = scoreEngine(CHROME_CAPS, { features: ["webrtc", "service_worker"] });
    expect(s.meets).toBe(true);
  });

  it("lightpanda fails when webrtc is required", () => {
    const s = scoreEngine(LIGHTPANDA_CAPS, { features: ["webrtc"] });
    expect(s.meets).toBe(false);
    expect(s.reasons?.[0]).toMatch(/webrtc/);
  });

  it("max_latency rejects slower engines", () => {
    const s = scoreEngine(CHROME_CAPS, { max_latency: "fast" });
    expect(s.meets).toBe(false);
  });

  it("cookies_for requires a matching inventory entry", () => {
    const inv = new Set(["chrome:linkedin.com"]);
    expect(scoreEngine(CHROME_CAPS, { cookies_for: ["linkedin.com"] }, inv).meets).toBe(true);
    expect(scoreEngine(CHROME_CAPS, { cookies_for: ["linkedin.com"] }).meets).toBe(false);
    expect(scoreEngine(LIGHTPANDA_CAPS, { cookies_for: ["linkedin.com"] }, inv).meets).toBe(false);
  });

  it("prefer_engines adds a tie-break bonus", () => {
    const a = scoreEngine(LIGHTPANDA_CAPS, {});
    const b = scoreEngine(LIGHTPANDA_CAPS, { prefer_engines: ["lightpanda"] });
    expect(b.score).toBeGreaterThan(a.score);
  });
});

describe("rankEngines + pickEngine", () => {
  it("ranks meeting engines first, then by score", () => {
    const ranked = rankEngines(ALL_ENGINES, {});
    expect(ranked[0].meets).toBe(true);
    expect(ranked[1].meets).toBe(true);
    // Both meet basic; lightpanda is cheaper → ranks higher
    expect(ranked[0].engine).toBe("lightpanda");
    expect(ranked[1].engine).toBe("chrome");
  });

  it("pickEngine returns lightpanda for trivial requirements", () => {
    expect(pickEngine(ALL_ENGINES, {})).toBe("lightpanda");
  });

  it("pickEngine returns chrome when webrtc required", () => {
    expect(pickEngine(ALL_ENGINES, { features: ["webrtc"] })).toBe("chrome");
  });

  it("pickEngine returns null when nothing matches", () => {
    expect(pickEngine([LIGHTPANDA_CAPS], { features: ["webrtc"] })).toBeNull();
  });

  it("prefer_engines flips ranking on tie", () => {
    const r = rankEngines(ALL_ENGINES, { prefer_engines: ["chrome"] });
    expect(r[0].engine).toBe("chrome");
  });
});
```

### TDD steps

- [ ] **Step 1: Write tests.** Run → FAIL.
- [ ] **Step 2: Write capability-router.ts per body above.**
- [ ] **Step 3: Re-run → expect PASS (7 + 5 = 12 tests).**
- [ ] **Step 4: Full suite: 874 + 12 = 886 passing.**
- [ ] **Step 5: Build clean.**
- [ ] **Step 6: Commit:**

```bash
git add orchestrator/src/engine/capability-router.ts \
        orchestrator/tests/engine/capability-router.test.ts
git commit -m "feat(engine): capability-router — score+rank engines against requirements"
```

---

## Task 3 — AxTreeNode state surfacing + ax_state verify check

**Model:** Sonnet — touches snapshot pipeline (small change) + adds new check type.

### Files

- Modify: `orchestrator/src/cognition/predicate.ts` — extend `AxTreeNode` with optional `s?` field
- Modify: `orchestrator/src/cognition/intention-types.ts` — add `ax_state` VerifyCheck variant
- Modify: `orchestrator/src/cognition/verify-runner.ts` — dispatch ax_state via new evalAxState helper
- Create: `orchestrator/src/cognition/ax-state.ts` — pure ax_state evaluator
- Create: `orchestrator/tests/cognition/ax-tree-state.test.ts` — predicate-side tests that `s` is preserved + readable
- Create: `orchestrator/tests/cognition/ax-state.test.ts` — verify-runner tests for ax_state

### Background — AX state shape

`page-health.ts` already defines `AxNode { i, r, n, s: unknown[], c? }`. The `s` field is populated by the snapshot pipeline from CDP `Accessibility.getFullAXTree()` properties — common entries include `{name: "disabled", value: {type: "boolean", value: true}}`, `{name: "checked", ...}`, `{name: "expanded", ...}`.

For Phase D, we DO NOT change the snapshot pipeline (the state is already collected). We extend the cognition `AxTreeNode` type to expose `s?` as `AxState[]` and write helpers that read it.

### Type changes (predicate.ts)

```typescript
/** A single AX property — name + value. Matches CDP Accessibility.AXProperty shape. */
export interface AxState {
  name: string;        // "disabled" | "checked" | "expanded" | "selected" | "focused" | "required" | ...
  value?: { type?: string; value?: unknown };
}

// Extend existing AxTreeNode:
export interface AxTreeNode {
  /** Stable ID */
  i: string;
  /** ARIA role */
  r: string;
  /** Accessible name */
  n: string;
  /** Children */
  c?: AxTreeNode[];
  /** AX state properties (optional — may be absent in synthetic snapshots). */
  s?: AxState[];
}
```

### Type changes (intention-types.ts)

Add `ax_state` to the VerifyCheck union:

```typescript
export type VerifyCheck =
  | { /* existing predicate */ }
  | { /* existing network */ }
  | { /* existing url */ }
  | { /* existing text_present */ }
  | { /* existing text_absent */ }
  | {
      type: "ax_state";
      role: string;
      /** Exact match on accessible name (case-insensitive). When omitted, matches any. */
      name?: string;
      /** State name to check (e.g., "disabled", "checked"). */
      state: string;
      /** Expected value (defaults to true). */
      expected?: boolean;
      description: string;
      retry?: RetryOptions;
    };
```

### ax-state.ts (new)

```typescript
import type { AxTreeNode, AxState } from "./predicate.js";

/** Find the first AX node matching role + (optional) name. Case-insensitive on name. */
export function findAxNode(
  root: AxTreeNode | undefined,
  role: string,
  name?: string,
): AxTreeNode | null {
  if (!root) return null;
  const stack: AxTreeNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.r === role) {
      if (name === undefined || n.n.toLowerCase() === name.toLowerCase()) {
        return n;
      }
    }
    if (Array.isArray(n.c)) for (const c of n.c) stack.push(c);
  }
  return null;
}

/** Read the value of a named AX state property. Returns undefined when missing. */
export function readAxState(node: AxTreeNode, stateName: string): unknown {
  const states = node.s as AxState[] | undefined;
  if (!Array.isArray(states)) return undefined;
  const entry = states.find((s) => s?.name === stateName);
  if (!entry) return undefined;
  return entry.value?.value;
}

/** Convenience boolean reader — coerces present-but-non-boolean to true (presence === active). */
export function readAxBool(node: AxTreeNode, stateName: string): boolean {
  const v = readAxState(node, stateName);
  if (v === undefined) return false;
  if (typeof v === "boolean") return v;
  return Boolean(v);
}
```

### verify-runner.ts changes

```typescript
import { findAxNode, readAxBool } from "./ax-state.js";
import type { Evidence } from "./intention-types.js";

function evalAxState(
  check: VerifyCheck & { type: "ax_state" },
  ctx: VerifyContext,
): Evidence {
  const node = findAxNode(ctx.snapshot.root, check.role, check.name);
  if (!node) {
    return {
      predicate: check.description,
      passed: false,
      observed_value: { reason: "node_not_found", role: check.role, name: check.name },
      ts: Date.now(),
      source: "ax",
      severity: "block",
    };
  }
  const actual = readAxBool(node, check.state);
  const expected = check.expected ?? true;
  return {
    predicate: check.description,
    passed: actual === expected,
    observed_value: { state: check.state, actual, expected },
    ts: Date.now(),
    source: "ax",
    severity: "block",
  };
}

// Extend the runVerify dispatcher:
if (check.type === "ax_state") return evalAxState(check, ctx);
```

### Tests (ax-state.test.ts)

```typescript
import { describe, it, expect } from "vitest";
import { runVerify } from "../../src/cognition/verify-runner.js";
import type { VerifyCheck, VerifyContext } from "../../src/cognition/verify-runner.js";

function nodeWithState(role: string, name: string, states: Array<{name: string; value: any}>) {
  return {
    url: "https://x.com/",
    snapshot: {
      url: "https://x.com/",
      root: {
        i: "r", r: "main", n: "",
        c: [{ i: "n1", r: role, n: name, s: states.map(s => ({ name: s.name, value: { value: s.value } })) }],
      },
    },
  } as unknown as VerifyContext;
}

describe("ax_state verify check", () => {
  it("passes when expected state is true", () => {
    const ctx = nodeWithState("button", "Send", [{ name: "disabled", value: true }]);
    const ev = runVerify({ type: "ax_state", role: "button", name: "Send", state: "disabled", description: "send disabled" } as VerifyCheck, ctx);
    expect(ev.passed).toBe(true);
    expect(ev.source).toBe("ax");
  });

  it("fails when expected=true but state is false", () => {
    const ctx = nodeWithState("button", "Send", [{ name: "disabled", value: false }]);
    const ev = runVerify({ type: "ax_state", role: "button", name: "Send", state: "disabled", description: "send disabled" } as VerifyCheck, ctx);
    expect(ev.passed).toBe(false);
  });

  it("passes with expected=false when state is absent (treated as false)", () => {
    const ctx = nodeWithState("button", "Send", []);
    const ev = runVerify({ type: "ax_state", role: "button", name: "Send", state: "disabled", expected: false, description: "not disabled" } as VerifyCheck, ctx);
    expect(ev.passed).toBe(true);
  });

  it("returns node_not_found when role+name don't match", () => {
    const ctx = nodeWithState("button", "Send", [{ name: "checked", value: true }]);
    const ev = runVerify({ type: "ax_state", role: "button", name: "Ghost", state: "checked", description: "ghost" } as VerifyCheck, ctx);
    expect(ev.passed).toBe(false);
    expect((ev.observed_value as any).reason).toBe("node_not_found");
  });

  it("matches without name (any node with role+state)", () => {
    const ctx = nodeWithState("checkbox", "First", [{ name: "checked", value: true }]);
    const ev = runVerify({ type: "ax_state", role: "checkbox", state: "checked", description: "any checked" } as VerifyCheck, ctx);
    expect(ev.passed).toBe(true);
  });

  it("name match is case-insensitive", () => {
    const ctx = nodeWithState("button", "Send Invite", [{ name: "disabled", value: true }]);
    const ev = runVerify({ type: "ax_state", role: "button", name: "send invite", state: "disabled", description: "ci" } as VerifyCheck, ctx);
    expect(ev.passed).toBe(true);
  });
});
```

### Tests (ax-tree-state.test.ts) — predicate-side structural check

```typescript
import { describe, it, expect } from "vitest";
import type { AxTreeNode, AxState } from "../../src/cognition/predicate.js";

describe("AxTreeNode.s shape", () => {
  it("compiles with optional s field of AxState[]", () => {
    const node: AxTreeNode = {
      i: "n1",
      r: "button",
      n: "Send",
      s: [{ name: "disabled", value: { type: "boolean", value: true } }],
    };
    expect(node.s?.[0].name).toBe("disabled");
  });

  it("AxState is independently importable", () => {
    const s: AxState = { name: "checked", value: { value: true } };
    expect(s.name).toBe("checked");
  });
});
```

### TDD steps

- [ ] **Step 1: Read predicate.ts to confirm AxTreeNode location + ESM exports.**
- [ ] **Step 2: Add AxState interface + `s?` to AxTreeNode in predicate.ts. Make sure existing predicate tests still pass (none of them touch `s`).**
- [ ] **Step 3: Write ax-tree-state.test.ts.** Run → expect PASS (structural compile test).
- [ ] **Step 4: Add `ax_state` VerifyCheck variant to intention-types.ts.**
- [ ] **Step 5: Write ax-state.test.ts → FAIL.**
- [ ] **Step 6: Create ax-state.ts (findAxNode, readAxState, readAxBool).**
- [ ] **Step 7: Update verify-runner.ts: import ax-state helpers, add evalAxState, extend dispatcher.**
- [ ] **Step 8: Re-run ax-state tests → expect PASS (6/6).**
- [ ] **Step 9: Full suite green: 886 + 2 + 6 = 894 passing.**
- [ ] **Step 10: Build clean.**
- [ ] **Step 11: Commit:**

```bash
git add orchestrator/src/cognition/predicate.ts \
        orchestrator/src/cognition/intention-types.ts \
        orchestrator/src/cognition/verify-runner.ts \
        orchestrator/src/cognition/ax-state.ts \
        orchestrator/tests/cognition/ax-tree-state.test.ts \
        orchestrator/tests/cognition/ax-state.test.ts
git commit -m "feat(cognition): AxTreeNode state surfacing + ax_state verify check"
```

---

## Task 4 — Observation-log integration (Evidence → cognition_observations)

**Model:** Sonnet — schema bump + storage extension + compiler hook.

### Files

- Modify: `orchestrator/src/cache/schema.ts` — bump SCHEMA_VERSION 4→5; add `evidence_json TEXT` + `intention_name TEXT` columns to `cognition_observations` (additive)
- Modify: `orchestrator/src/cognition/storage.ts` — extend `recordObservation` to accept optional `intention_name` + `evidence`
- Modify: `orchestrator/src/cognition/types.ts` — extend `Observation` interface
- Create: `orchestrator/src/cognition/observation-link.ts` — helper that the compiler calls to write a per-intention observation
- Modify: `orchestrator/src/cognition/intention-compiler.ts` — at the end of `execute()` (success or failure), call observation-link to log
- Create: `orchestrator/tests/cognition/observation-link.test.ts`

### Schema change

```typescript
export const SCHEMA_VERSION = 5;

// In the cognition_observations DDL, after the existing columns:
//   intention_name TEXT,
//   evidence_json TEXT,
```

Note: `ALTER TABLE ADD COLUMN` is not part of the existing `IF NOT EXISTS` pattern. Use a guarded migration: check `PRAGMA table_info(cognition_observations)` for the new columns; if absent, run `ALTER TABLE`. This keeps existing rows.

### Observation type extension (types.ts)

```typescript
export interface Observation {
  site: string;
  ts: number;
  prev_state: StateId | null;
  current_state: StateId;
  url: string;
  snapshot_summary: string;
  action_taken: ActionStep | null;
  /** When the observation was triggered by an intention (Phase D). */
  intention_name?: string;
  /** Evidence collected during the intention run (Phase D). */
  evidence?: Evidence[];
}
```

### Storage extension

Update `recordObservation` to write the new columns:

```typescript
recordObservation(o: Observation): void {
  this.db.prepare(`
    INSERT INTO cognition_observations
      (site, ts, prev_state, current_state, url, snapshot_summary, action_taken_json, intention_name, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    o.site, o.ts, o.prev_state ?? null, o.current_state,
    o.url, o.snapshot_summary,
    o.action_taken ? JSON.stringify(o.action_taken) : null,
    o.intention_name ?? null,
    o.evidence ? JSON.stringify(o.evidence) : null,
  );
}
```

(Adjust column names to match what's actually in the existing schema — `action_taken_json` may be named differently.)

Also update `recentObservations` deserialization to populate the new fields.

### observation-link.ts

```typescript
import type { CognitionStorage } from "./storage.js";
import type { Evidence, Outcome } from "./intention-types.js";

/**
 * Write a per-intention observation log entry.
 * Called by IntentionCompiler at the end of execute() (success or failure).
 */
export function linkOutcomeToObservation(
  storage: CognitionStorage,
  site: string,
  url: string,
  outcome: Outcome,
): void {
  storage.recordObservation({
    site,
    ts: Date.now(),
    prev_state: outcome.state_before ?? null,
    current_state: outcome.state_after ?? outcome.state_before ?? "unknown",
    url,
    snapshot_summary: JSON.stringify({ intention: outcome.intention, ok: outcome.ok, reason: outcome.reason }),
    action_taken: null,
    intention_name: outcome.intention,
    evidence: outcome.evidence,
  });
}
```

### Compiler hook

At the end of `execute()`, just before each `return outcome | failOutcome(...)`, call `linkOutcomeToObservation(this.storage, this.site, session.currentUrl(), outcome)`. But: the compiler doesn't currently hold a `CognitionStorage`. Pass it via `CompilerOptions.storage` (optional — when absent, no logging).

```typescript
export interface CompilerOptions {
  graph: StateGraph;
  site: string;
  storage?: CognitionStorage;  // NEW — when set, outcomes get logged
  now?: () => number;
}
```

### Tests (observation-link.test.ts)

```typescript
// Use real :memory: SQLite via SiteGraphCache.
import { describe, it, expect, afterEach } from "vitest";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { CognitionStorage } from "../../src/cognition/storage.js";
import { linkOutcomeToObservation } from "../../src/cognition/observation-link.js";
import type { Outcome } from "../../src/cognition/intention-types.js";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

describe("observation-link", () => {
  let dir: string;
  let cache: SiteGraphCache;
  let storage: CognitionStorage;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "husk-m21-"));
    cache = new SiteGraphCache(dir);
    storage = new CognitionStorage(cache);
  });

  afterEach(() => { cache.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it("writes evidence + intention_name into cognition_observations", () => {
    const outcome: Outcome = {
      ok: true,
      intention: "test_intention",
      args: {},
      state_before: "s1",
      state_after: "s2",
      evidence: [{ predicate: "x", passed: true, source: "url" }],
      duration_ms: 100,
      steps_observed: [],
    };
    linkOutcomeToObservation(storage, "test.com", "https://test.com/", outcome);
    const rows = storage.recentObservations("test.com", 0);
    expect(rows).toHaveLength(1);
    expect(rows[0].intention_name).toBe("test_intention");
    expect(rows[0].evidence).toHaveLength(1);
    expect(rows[0].evidence?.[0].passed).toBe(true);
  });

  it("handles failure outcomes (no state_after)", () => {
    const outcome: Outcome = {
      ok: false,
      intention: "broken",
      args: {},
      state_before: "s1",
      evidence: [],
      duration_ms: 50,
      reason: "verify_failed",
      steps_observed: [],
    };
    linkOutcomeToObservation(storage, "test.com", "https://test.com/", outcome);
    const rows = storage.recentObservations("test.com", 0);
    expect(rows).toHaveLength(1);
    expect(rows[0].intention_name).toBe("broken");
  });

  it("schema v5 includes intention_name + evidence_json columns", () => {
    const cols = cache.db.prepare("PRAGMA table_info(cognition_observations)").all() as Array<{name: string}>;
    const names = cols.map(c => c.name);
    expect(names).toContain("intention_name");
    expect(names).toContain("evidence_json");
  });
});
```

### TDD steps

- [ ] **Step 1: Read storage.ts to find the current cognition_observations DDL + recordObservation + recentObservations.**
- [ ] **Step 2: Bump SCHEMA_VERSION 4→5; update the DDL block to include the new columns; add a guarded ALTER TABLE for v4→v5 migration (skip the ALTER if PRAGMA shows columns already present).**
- [ ] **Step 3: Update Observation type + storage write/read to thread the new fields.**
- [ ] **Step 4: Write observation-link.ts.**
- [ ] **Step 5: Write tests → FAIL → run → fix.**
- [ ] **Step 6: Modify intention-compiler.ts: thread `storage` through CompilerOptions; call linkOutcomeToObservation before each return.**
- [ ] **Step 7: Verify existing compiler tests still pass (the new option is optional; they don't supply it).**
- [ ] **Step 8: Full suite: 894 + 3 = 897 passing.**
- [ ] **Step 9: Build clean.**
- [ ] **Step 10: Commit:**

```bash
git add orchestrator/src/cache/schema.ts \
        orchestrator/src/cognition/storage.ts \
        orchestrator/src/cognition/types.ts \
        orchestrator/src/cognition/observation-link.ts \
        orchestrator/src/cognition/intention-compiler.ts \
        orchestrator/tests/cognition/observation-link.test.ts
git commit -m "feat(cognition): observation-log integration (Evidence → cognition_observations, schema v5)"
```

---

## Task 5 — Intention/Session capability declaration + router wiring

**Model:** Sonnet — wire capability through to the engine-router; backward-compat preserved.

### Files

- Modify: `orchestrator/src/cognition/intention-types.ts` — add `capability?: CapabilityRequirement` to Intention
- Modify: `orchestrator/src/engine/engine-router.ts` — add `acquireForCapability(req, sessionId)` alongside `acquire(kind, sessionId)`
- Modify: `orchestrator/src/session/session.ts` — accept capability in createSession/intend; route through new acquire method when capability is present
- Modify: `orchestrator/src/http/methods.ts` — accept `capability` in create_session params
- Modify: `sdk-ts/src/types.ts` + `sdk-py/husk/_types.py` — mirror CapabilityRequirement
- Modify: SDK session.ts/_session.py — accept capability arg on createSession/intend
- Create: relevant tests

### Behavior

- `intend(intention_name, args, site?, capability?)` — when capability is set on the call OR on the intention itself, the compiler ensures the session's engine satisfies it. If not, it requests a new engine via `EngineRouter.acquireForCapability(req)`. If no engine matches, returns `Outcome` with `reason: "engine_unsupported"`.
- `acquireForCapability(req, sessionId)`: maps the requirement to a kind via `pickEngine(ALL_ENGINES, req)`, then delegates to the existing `acquire(kind, sessionId)`.
- Phase B/C intentions without capability → no change.

### engine-router.ts addition

```typescript
import { pickEngine } from "./capability-router.js";
import { ALL_ENGINES } from "./engine-capabilities.js";
import type { CapabilityRequirement } from "./capability-types.js";

export interface EngineRouter {
  acquire(kind: EngineKind, sessionId: string): Promise<EngineHandle>;
  acquireForCapability(req: CapabilityRequirement, sessionId: string, cookieInventory?: Set<string>): Promise<EngineHandle | null>;
}

// In the factory:
acquireForCapability: async (req, sessionId, cookieInventory) => {
  const engineName = pickEngine(ALL_ENGINES, req, cookieInventory);
  if (!engineName) return null;
  return this.acquire(engineName as EngineKind, sessionId);
},
```

### Intention type extension

```typescript
export interface Intention {
  // ...existing fields
  capability?: CapabilityRequirement;
}
```

### Compiler integration

In `execute()`, before snapshot+identify:

```typescript
// Resolve effective capability (intention-declared union call-supplied; call wins on conflict).
const effectiveCap = args.capability ?? intention.capability;

if (effectiveCap && this.router && !this.engineSatisfies(effectiveCap)) {
  const handle = await this.router.acquireForCapability(effectiveCap, session.sessionId);
  if (!handle) {
    return this.failOutcome(intention, args, null, undefined, "engine_unsupported", "no engine satisfies capability requirement", [], [], t0);
  }
  // ...session swap via existing M17 fallback infrastructure
}
```

(The exact wire-through depends on how Session exposes engine-handle swap. Use the M17 fallback path. Read `engine/fallback.ts` to find the swap helper.)

### Tests

- Engine-router test: `acquireForCapability` delegates to acquire(kind=picked).
- Compiler test: intention with capability `{features: ["webrtc"]}` forces a chrome acquire.
- Compiler test: intention with capability that nothing satisfies returns `engine_unsupported`.

### TDD steps

- [ ] **Step 1: Read engine-router.ts + fallback.ts to understand the swap path.**
- [ ] **Step 2: Add acquireForCapability to EngineRouter (interface + factory).**
- [ ] **Step 3: Add capability? to Intention type.**
- [ ] **Step 4: Write engine-router test for acquireForCapability (use stubbed pool adapters).**
- [ ] **Step 5: Add capability handling to compiler.**
- [ ] **Step 6: Write compiler tests for cap-driven behavior.**
- [ ] **Step 7: Update SDKs (TS + Py) with optional capability field.**
- [ ] **Step 8: Update HTTP method to pass capability through.**
- [ ] **Step 9: Full suite green.**
- [ ] **Step 10: Build clean.**
- [ ] **Step 11: Commit:**

```bash
git add orchestrator/src/engine/engine-router.ts \
        orchestrator/src/cognition/intention-types.ts \
        orchestrator/src/cognition/intention-compiler.ts \
        orchestrator/src/session/session.ts \
        orchestrator/src/http/methods.ts \
        sdk-ts/src/types.ts sdk-ts/src/session.ts \
        sdk-py/husk/_types.py sdk-py/husk/_session.py \
        orchestrator/tests/engine/engine-router-capability.test.ts \
        orchestrator/tests/cognition/intention-compiler-cap.test.ts
git commit -m "feat(capability): Intention.capability + acquireForCapability + SDK plumbing"
```

---

## Task 6 — Real-lightpanda + chrome integration test

**Model:** Sonnet — proves the wire path against real engines.

### Files

- Create: `orchestrator/tests/integration/cognition-capability.test.ts`

### Test plan

1. Skip when LIGHTPANDA_BIN is unset (existing pattern).
2. Skip Chrome-specific test when no chrome detected (use existing helper if there is one; otherwise probe via `engine/binary.ts`).
3. Test cases:
   - **Default capability picks lightpanda**: intention with no capability → engine=lightpanda; outcome.ok matches expected; recorded observation log entry has lightpanda.
   - **webrtc requirement picks chrome**: intention with `capability: {features: ["webrtc"]}` → router selects chrome; if chrome is available, outcome.ok=true; if not available, outcome.reason="engine_unsupported".
   - **ax_state against fixture**: fixture serves `<button disabled>Send</button>`; intention verify `[{type: "ax_state", role: "button", name: "Send", state: "disabled"}]` → passes if the snapshot pipeline correctly populates `s`. (If lightpanda doesn't populate AX state, skip this with a note; chrome should.)

### TDD steps

- [ ] **Step 1: Read existing integration tests for the patterns + chrome detection.**
- [ ] **Step 2: Write the 3 test cases with appropriate skip-guards.**
- [ ] **Step 3: Run with lightpanda + chrome if available:**
  `LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda pnpm --filter husk-orchestrator test integration/cognition-capability`
- [ ] **Step 4: Run full suite (no lightpanda) — tests skip; no regression.**
- [ ] **Step 5: Commit:**

```bash
git add orchestrator/tests/integration/cognition-capability.test.ts
git commit -m "test(integration): cognition capability + ax_state e2e against real engines"
```

---

## Task 7 — Docs + memory + tag + merge

**Model:** Haiku.

### Spec amendment

Append a Phase D block to the v0.1 spec's Implementation Progress section. List shipped items (capability types, router, ax_state, observation-log integration), explicitly deferred items (real-user engine, Evidence weighting, compound recovery options), updated test count.

### Memory updates

- `husk-roadmap.md`: `v0.0.20-m21 — Phase D of v0.1 (Capability Router + ax_state + observation log)`
- `husk-architecture.md`: append "Cognition Layer — Phase D" subsection
- `husk-overview.md`: status "Phase D of 6 complete"

### Tag + merge

```bash
git tag -a v0.0.20-m21 -m "M21: v0.1 Phase D — Capability Router + ax_state + observation log

- CapabilityRequirement + EngineCapabilities + capability-router (score+rank)
- AxTreeNode.s state surfacing + ax_state verify check
- Observation-log integration: Evidence → cognition_observations (schema v5)
- Intention.capability wired through engine-router
- SDK mirror updates (TS + Py)
- MCP surface unchanged: 21 tools

Phase E (streaming protocol + subscription bus) is next."

git checkout main
git merge --no-ff m21-capability-router -m "Merge Milestone 21 (v0.1 Phase D: Capability Router)"
```

DO NOT push.

---

## Self-review

**Spec coverage:**
- §3 capability router rewrite ✓
- §4.4 engine_unsupported failure reason wired ✓
- §4.6 confidence — observation-log integration enables future learning ✓
- §4.7 memory model — Evidence persisted in cognition_observations ✓

**No placeholders:** Each step shows actual code, test bodies, exact commands. Engine fingerprints are concrete data, not "TBD".

**Type consistency:** CapabilityRequirement defined in T1, reused throughout T2-T6. AxState defined in T3, reused throughout. Observation extension is additive (all new fields optional).

**Tool bloat:** +0 new MCP tools, +0 new JSON-RPC methods. Capability is a parameter, not a tool. ✓

**Backward compat:**
- M17's `engine: "auto"|"lightpanda"|"chrome"` still works (existing `acquire(kind, …)` unchanged)
- M19/M20 intentions without capability work unchanged
- M18's `cognition_observations` rows get null intention_name + evidence (additive columns)
- Cognition AxTreeNode without `s` still parses (field is optional) ✓

**Engine independence:** Verify checks work the same on lightpanda and chrome. AX state is populated by whichever engine; if lightpanda doesn't populate `s`, `ax_state` checks fail gracefully (node_not_found / undefined state). ✓

---

## Execution

Subagent-driven, same flow as M18-M20:
- T1 → review → T2 → review → … → T7
- Continuous execution; no checkpoints between tasks
- Combined spec+code review for T1, T2, T7 (mechanical)
- Separate spec then code review for T3, T4, T5 (substantive)
- Tag + merge at end; no push.

Branch: `m21-capability-router` (already cut from main).
