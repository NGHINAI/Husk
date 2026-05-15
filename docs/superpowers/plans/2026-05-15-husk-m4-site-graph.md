# Husk Milestone 4 (Site Graph Cache) — Per-Domain SQLite Observability + M5 Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every (domain, stable_id, role, name, xpath, timestamp) tuple Husk observes in a per-domain SQLite database under `~/.husk/site-graph/{domain}.db`. Expose a query API the M5 watchdog will use for rejection-envelope candidate generation ("element X not found — did you mean one of these?"). Foundation for M8 auth pillar (cookies live per-domain too), M9 DOM-drift router (cross-deploy stable IDs need this persistence), and M11 vertical recipes (pre-built site graphs ARE this cache, prepopulated).

**Architecture:** A `SiteGraphCache` class wraps a connection pool of `better-sqlite3` databases — one per domain, opened lazily. On every `Session.snapshot()`, the cache observes the full snapshot tree and upserts each node's metadata. The cache exposes `query()` for downstream consumers (M5 watchdog, observability tools). Each session gets a cache reference at construction; closing a session does NOT close the underlying database files (they're shared and lifetime-tied to the orchestrator process).

**Tech Stack:** TypeScript 5.5, Node 20 LTS, `better-sqlite3` ^11 (synchronous, fast, no async overhead), vitest. No new orchestrator surface other than the cache itself; M5 wires it into the watchdog.

**Source spec:** [`docs/superpowers/specs/2026-05-13-husk-design.md`](../specs/2026-05-13-husk-design.md), Section 5.1 ("Storage and lookup") + Section 9 (dependencies — `better-sqlite3` listed there).

**Branch:** `m4-site-graph` (already created — verify with `git branch --show-current` returns `m4-site-graph`).

**Estimated duration:** ~1 week for one engineer.

**Prerequisites:**
- M3 merged to main, tag `v0.0.4-m3` exists
- `husk start` serves JSON-RPC on `:7777`
- Snapshot adapter from M2 emits `(stable_id, role, name, xpath)` tuples per node

---

## Pre-task Design Decisions

### Decision A — Per-domain SQLite file, not a single shared database

Each domain gets its own file at `~/.husk/site-graph/{domain}.db`. Reasons:
- Naturally bounds the cache size per site (no global table that grows forever)
- Simplifies "forget about example.com" — just delete the file
- M8 auth pillar will reuse the per-domain pattern (cookies + site graph living together makes sense)
- SQLite handles 1000s of files fine

Cost: a process holding 50 active domains has 50 file handles open. Acceptable for v0; v0.3 cloud milestone may consolidate.

### Decision B — Synchronous `better-sqlite3`, not async `node:sqlite` or `sqlite3`

`better-sqlite3` is synchronous because SQLite itself is synchronous. Native async wrappers add overhead and complicate error handling without delivering real parallelism (SQLite serializes writes regardless). All our writes are small (~200 bytes per row), so blocking the event loop is negligible. Industry standard for Node-side SQLite use cases.

Trade: `better-sqlite3` requires native compilation per platform during install. Prebuilt binaries cover macOS arm64 / x64, Linux x64 / arm64, Windows x64. Sufficient for our M7 release matrix.

### Decision C — Domain normalization: lowercased registrable domain

`example.com` and `www.example.com` and `EXAMPLE.COM` all map to `example.com`. `mail.example.com` stays separate. Implementation: take `URL.hostname`, lowercase, strip leading `www.`. We do NOT use Public Suffix List in v0 — `co.uk` etc. as bare TLDs are accepted as-is. Rare in production.

### Decision D — Upsert on every snapshot, not on every action

Every time `Session.snapshot()` runs, walk the snapshot tree and upsert every node. This is cheap (SQLite handles 10K inserts/sec easily; a 200-node snapshot is sub-millisecond). It means every observation is durable, which is what M11 vertical recipes / M9 DOM-drift need.

### Decision E — No fuzzy resolver in M4

Spec §5.1 describes a multi-step fuzzy fallback (cached → role+name fuzzy → role-only fuzzy → drift event). For v0 we defer the *fuzzy resolution* to M5 (it's part of the watchdog's candidate generation). M4 just gives M5 the data; M5 does the matching.

### Decision F — Cache directory is overridable for testing

`HUSK_CACHE_DIR` env var overrides the default `~/.husk/site-graph/`. Tests pass a fresh tmpdir per run.

---

## File Structure

### New TypeScript source files

| Path | Lines | Responsibility |
|---|---|---|
| `orchestrator/src/cache/domain.ts` | ~60 | `normalizeDomain(url)` — extract & lowercase hostname, strip `www.`. |
| `orchestrator/src/cache/schema.ts` | ~80 | SQL schema + migrations. Idempotent `applySchema(db)`. |
| `orchestrator/src/cache/site-graph.ts` | ~180 | `SiteGraphCache` class — connection pool, `observe(snapshot)`, `query(domain, criteria)`, `close()`. |
| `orchestrator/src/cache/types.ts` | ~50 | `SiteGraphRow` type, `QueryCriteria`, `QueryResult`. |
| `orchestrator/src/session/session.ts` | modify (~15 lines) | Accept optional `siteGraph` in `SessionOptions`; observe after each snapshot. |
| `orchestrator/src/index.ts` | modify (~10 lines) | `husk start` constructs a `SiteGraphCache` and passes it to `SessionManager`. |

### New tests

| Path | Covers |
|---|---|
| `orchestrator/tests/cache/domain.test.ts` | hostname normalization, edge cases (IP, port, hash) |
| `orchestrator/tests/cache/schema.test.ts` | applySchema idempotency, indices created |
| `orchestrator/tests/cache/site-graph.test.ts` | observe/query/close, per-domain file isolation, query criteria |

### New dependencies in `orchestrator/package.json`

```json
"dependencies": {
  "@noble/hashes": "^1.5.0",
  "@hono/node-server": "^1.13.0",
  "better-sqlite3": "^11.6.0",
  "hono": "^4.6.0",
  "pino": "^9.5.0",
  "ws": "^8.18.0"
},
"devDependencies": {
  "@types/better-sqlite3": "^7.6.12"
  // ... existing
}
```

---

## Tasks

### Task 1: Domain normalization

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/cache/domain.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/cache/domain.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/cache/domain.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { normalizeDomain, isValidDomain } from "../../src/cache/domain.js";

describe("normalizeDomain", () => {
  it("extracts hostname from a full URL", () => {
    expect(normalizeDomain("https://example.com/foo/bar?x=1")).toBe("example.com");
  });

  it("lowercases the hostname", () => {
    expect(normalizeDomain("https://EXAMPLE.COM/")).toBe("example.com");
  });

  it("strips leading www.", () => {
    expect(normalizeDomain("https://www.example.com/")).toBe("example.com");
  });

  it("preserves non-www subdomains", () => {
    expect(normalizeDomain("https://mail.example.com/")).toBe("mail.example.com");
    expect(normalizeDomain("https://api.v2.example.com/")).toBe("api.v2.example.com");
  });

  it("ignores port number", () => {
    expect(normalizeDomain("http://example.com:8080/")).toBe("example.com");
  });

  it("ignores path, query, and fragment", () => {
    expect(normalizeDomain("https://example.com/path?q=1#hash")).toBe("example.com");
  });

  it("works with IPv4 hostnames", () => {
    expect(normalizeDomain("http://127.0.0.1:7777/")).toBe("127.0.0.1");
  });

  it("works with IPv6 hostnames", () => {
    // URL parser strips brackets from hostname
    expect(normalizeDomain("http://[::1]:8080/")).toBe("::1");
  });

  it("throws on invalid URL", () => {
    expect(() => normalizeDomain("not a url")).toThrow();
  });
});

describe("isValidDomain", () => {
  it("accepts a clean hostname", () => {
    expect(isValidDomain("example.com")).toBe(true);
    expect(isValidDomain("mail.example.com")).toBe(true);
    expect(isValidDomain("127.0.0.1")).toBe(true);
  });

  it("rejects domains with path separators or unsafe chars (DB filename safety)", () => {
    expect(isValidDomain("example.com/foo")).toBe(false);
    expect(isValidDomain("../etc/passwd")).toBe(false);
    expect(isValidDomain("example com")).toBe(false);
    expect(isValidDomain("")).toBe(false);
  });

  it("rejects domains longer than 253 chars (DNS limit)", () => {
    const longLabel = "a".repeat(254);
    expect(isValidDomain(longLabel)).toBe(false);
  });
});
```

- [ ] **Step 2: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/cache/domain.test.ts 2>&1 | tail -10
```

Expected: FAIL — module `../../src/cache/domain.js` not found.

- [ ] **Step 3: Implement**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/cache/domain.ts`:

```typescript
/**
 * Domain normalization for the site graph cache.
 *
 * We want example.com, www.example.com, and EXAMPLE.COM to all share the
 * same cache. We do NOT want example.com and mail.example.com to share —
 * subdomains often serve completely different apps.
 *
 * v0 rule: hostname (no port/path/query) → lowercased → leading "www."
 * stripped. No Public Suffix List handling.
 */
export function normalizeDomain(url: string): string {
  const u = new URL(url); // throws on invalid input
  let host = u.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  return host;
}

/**
 * Reject domain strings that would be unsafe as filenames or are
 * implausibly long. Used as a defense-in-depth check before opening a
 * `~/.husk/site-graph/{domain}.db` file.
 */
export function isValidDomain(domain: string): boolean {
  if (!domain) return false;
  if (domain.length > 253) return false;
  // Reject anything that looks like a path traversal or whitespace
  if (/[\s/\\]/.test(domain)) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  if (domain.includes("..")) return false;
  return true;
}
```

- [ ] **Step 4: Run test, confirm pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/cache/domain.test.ts 2>&1 | tail -10
```

Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/src/cache/domain.ts orchestrator/tests/cache/domain.test.ts
git commit -m "feat(cache): domain normalization for site graph file paths"
```

---

### Task 2: SQLite schema + applySchema migration helper

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/cache/schema.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/cache/schema.test.ts`

This task adds `better-sqlite3` as a dep and lands the schema-application code that every new domain DB will run.

- [ ] **Step 1: Add better-sqlite3 + @types/better-sqlite3 to orchestrator/package.json**

```sh
cd /Users/nirmalghinaiya/Desktop/husk && \
  pnpm --filter ./orchestrator add better-sqlite3@^11.6.0 && \
  pnpm --filter ./orchestrator add -D @types/better-sqlite3@^7.6.12
```

Verify install:

```sh
ls /Users/nirmalghinaiya/Desktop/husk/orchestrator/node_modules/better-sqlite3/package.json
ls /Users/nirmalghinaiya/Desktop/husk/orchestrator/node_modules/@types/better-sqlite3/package.json
```

Both should exist. `better-sqlite3`'s native compile may take ~30-60 seconds on first install (it's compiling for your platform).

- [ ] **Step 2: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/cache/schema.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applySchema, SCHEMA_VERSION } from "../../src/cache/schema.js";

describe("applySchema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates the selectors table with all expected columns", () => {
    applySchema(db);
    const cols = db.prepare("PRAGMA table_info(selectors)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "stable_id",
        "current_css",
        "current_xpath",
        "role",
        "name_norm",
        "last_seen_at",
        "hit_count",
        "miss_count",
      ].sort()
    );
  });

  it("creates the role+name_norm index", () => {
    applySchema(db);
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all() as Array<{ name: string }>;
    const names = idx.map((i) => i.name);
    expect(names).toContain("idx_selectors_role_name");
  });

  it("creates a schema_meta table tracking the version", () => {
    applySchema(db);
    const version = (
      db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get() as { value: string }
    ).value;
    expect(version).toBe(String(SCHEMA_VERSION));
  });

  it("is idempotent — running twice does not throw or duplicate", () => {
    applySchema(db);
    expect(() => applySchema(db)).not.toThrow();
    const count = (
      db.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='selectors'").get() as {
        c: number;
      }
    ).c;
    expect(count).toBe(1);
  });

  it("stable_id is the primary key (rejects duplicate inserts)", () => {
    applySchema(db);
    const insert = db.prepare(
      "INSERT INTO selectors (stable_id, current_xpath, role, name_norm, last_seen_at) VALUES (?, ?, ?, ?, ?)"
    );
    insert.run("btn:abc", "/main/[0]", "button", "submit", Date.now());
    expect(() => insert.run("btn:abc", "/main/[0]", "button", "submit", Date.now())).toThrow();
  });
});
```

- [ ] **Step 3: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/cache/schema.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/cache/schema.ts`:

```typescript
import type { Database } from "better-sqlite3";

/**
 * Current schema version. Bump and add a migration block to applySchema
 * whenever a column changes.
 */
export const SCHEMA_VERSION = 1;

/**
 * Apply the Husk site-graph SQLite schema to a database connection.
 * Idempotent: running multiple times against the same DB is safe.
 *
 * The `selectors` table mirrors spec §5.1:
 *   - stable_id      TEXT PRIMARY KEY  — `${role}:${22-char-base64-blake3}`
 *   - current_css    TEXT              — last-known CSS selector (v0.1+; null in v0)
 *   - current_xpath  TEXT              — last-known synthetic a11y-tree xpath
 *   - role           TEXT              — ARIA role
 *   - name_norm      TEXT              — normalized accessible name
 *   - last_seen_at   INTEGER           — unix ms
 *   - hit_count      INTEGER           — fuzzy-resolve cache hits (v0.1+; always 0 in v0)
 *   - miss_count     INTEGER           — fuzzy-resolve cache misses (v0.1+; always 0 in v0)
 *
 * Index `idx_selectors_role_name` speeds up M5 watchdog's candidate
 * generation (find similar elements by role + name when stable_id is dead).
 */
export function applySchema(db: Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS selectors (
      stable_id     TEXT PRIMARY KEY,
      current_css   TEXT,
      current_xpath TEXT,
      role          TEXT NOT NULL,
      name_norm     TEXT NOT NULL,
      last_seen_at  INTEGER NOT NULL,
      hit_count     INTEGER NOT NULL DEFAULT 0,
      miss_count    INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_selectors_role_name
      ON selectors(role, name_norm);
  `);

  // Record / verify schema version
  const existing = db
    .prepare("SELECT value FROM schema_meta WHERE key = 'version'")
    .get() as { value: string } | undefined;
  if (!existing) {
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('version', ?)").run(
      String(SCHEMA_VERSION)
    );
  }
  // Future: migrations from older versions go here. v0 starts at 1.
}
```

- [ ] **Step 5: Tests pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/cache/schema.test.ts 2>&1 | tail -10
```

Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/package.json orchestrator/src/cache/schema.ts orchestrator/tests/cache/schema.test.ts pnpm-lock.yaml
git commit -m "feat(cache): SQLite schema + better-sqlite3 dep"
```

---

### Task 3: SiteGraphCache types

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/cache/types.ts`

Types-only file. No test of its own.

- [ ] **Step 1: Create types.ts**

```typescript
/**
 * Type definitions for the site graph cache.
 */

/** One row in the `selectors` table. Matches the SQLite column shape. */
export interface SiteGraphRow {
  stable_id: string;
  /** v0.1+ for cross-deploy DOM-drift router; null in v0 */
  current_css: string | null;
  current_xpath: string | null;
  role: string;
  name_norm: string;
  /** Unix milliseconds */
  last_seen_at: number;
  /** v0.1+ fuzzy-resolve cache stats; always 0 in v0 */
  hit_count: number;
  miss_count: number;
}

/** Criteria for `SiteGraphCache.query()`. All fields optional; intersection semantics. */
export interface QueryCriteria {
  /** Look up by exact stable_id. Returns 0 or 1 row. */
  stable_id?: string;
  /** Match by exact ARIA role. */
  role?: string;
  /** Match by normalized accessible name (exact equality on already-normalized form). */
  name_norm?: string;
  /** Limit results. Default: no limit. */
  limit?: number;
}

/** Cache configuration. */
export interface SiteGraphConfig {
  /** Directory containing per-domain `*.db` files. Default: ~/.husk/site-graph */
  cacheDir: string;
}
```

- [ ] **Step 2: Typecheck**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm typecheck 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/src/cache/types.ts
git commit -m "feat(cache): site graph type definitions"
```

---

### Task 4: SiteGraphCache class

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/cache/site-graph.ts`
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/cache/site-graph.test.ts`

The class is the public surface for M5 watchdog + future M9/M11. It manages a per-domain DB connection pool, exposes `observe(snapshot)` to upsert all stable_ids in a snapshot, and `query(domain, criteria)` for downstream lookup.

- [ ] **Step 1: Write the failing test**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/cache/site-graph.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import type { Snapshot } from "../../src/snapshot/types.js";

function makeSnapshot(url: string, nodes: Array<{ i: string; r: string; n: string }>): Snapshot {
  // Construct a flat snapshot tree from a list of nodes (first is root).
  const [root, ...rest] = nodes;
  const c = rest.map((n) => ({ ...n, s: ["v" as const] }));
  return {
    v: 1,
    url,
    count: nodes.length,
    root: { ...root, s: ["v" as const], c: c.length ? c : undefined },
  };
}

describe("SiteGraphCache", () => {
  let cacheDir: string;
  let cache: SiteGraphCache;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "husk-cache-test-"));
    cache = new SiteGraphCache({ cacheDir });
  });

  afterEach(() => {
    cache.close();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("creates a per-domain .db file on first observation", () => {
    cache.observe(
      makeSnapshot("https://example.com/page", [
        { i: "RootWebArea:abc", r: "RootWebArea", n: "Page" },
        { i: "button:xyz", r: "button", n: "Submit" },
      ])
    );
    expect(existsSync(join(cacheDir, "example.com.db"))).toBe(true);
  });

  it("normalizes www. into the bare domain", () => {
    cache.observe(
      makeSnapshot("https://www.example.com/", [
        { i: "RootWebArea:a", r: "RootWebArea", n: "X" },
      ])
    );
    expect(existsSync(join(cacheDir, "example.com.db"))).toBe(true);
    expect(existsSync(join(cacheDir, "www.example.com.db"))).toBe(false);
  });

  it("query(domain, {stable_id}) returns the upserted row", () => {
    cache.observe(
      makeSnapshot("https://example.com/", [
        { i: "RootWebArea:r1", r: "RootWebArea", n: "Page" },
        { i: "button:b1", r: "button", n: "Submit Application" },
      ])
    );
    const rows = cache.query("example.com", { stable_id: "button:b1" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      stable_id: "button:b1",
      role: "button",
      name_norm: "submit application",
    });
    expect(rows[0].last_seen_at).toBeGreaterThan(0);
  });

  it("query(domain, {role}) returns all rows with that role", () => {
    cache.observe(
      makeSnapshot("https://example.com/", [
        { i: "RootWebArea:r", r: "RootWebArea", n: "" },
        { i: "button:a", r: "button", n: "Submit" },
        { i: "button:b", r: "button", n: "Cancel" },
        { i: "link:c", r: "link", n: "Home" },
      ])
    );
    const buttons = cache.query("example.com", { role: "button" });
    expect(buttons).toHaveLength(2);
    expect(buttons.map((r) => r.stable_id).sort()).toEqual(["button:a", "button:b"]);
  });

  it("query(domain, {role, name_norm}) intersects both criteria", () => {
    cache.observe(
      makeSnapshot("https://example.com/", [
        { i: "RootWebArea:r", r: "RootWebArea", n: "" },
        { i: "button:a", r: "button", n: "Submit" },
        { i: "button:b", r: "button", n: "Cancel" },
        { i: "link:c", r: "link", n: "Submit" },
      ])
    );
    const matches = cache.query("example.com", { role: "button", name_norm: "submit" });
    expect(matches).toHaveLength(1);
    expect(matches[0].stable_id).toBe("button:a");
  });

  it("query(domain) returns empty array when domain has never been observed", () => {
    const rows = cache.query("never-seen.example.com", { stable_id: "x" });
    expect(rows).toEqual([]);
  });

  it("observe() is idempotent — same stable_id observed twice updates last_seen_at, not duplicates", () => {
    cache.observe(
      makeSnapshot("https://example.com/", [
        { i: "RootWebArea:r", r: "RootWebArea", n: "" },
        { i: "button:a", r: "button", n: "Submit" },
      ])
    );
    const firstSeenAt = cache.query("example.com", { stable_id: "button:a" })[0].last_seen_at;
    // Sleep just enough for the millisecond clock to tick
    const target = Date.now() + 2;
    while (Date.now() < target) {
      /* spin */
    }
    cache.observe(
      makeSnapshot("https://example.com/", [
        { i: "RootWebArea:r", r: "RootWebArea", n: "" },
        { i: "button:a", r: "button", n: "Submit" },
      ])
    );
    const rows = cache.query("example.com", { stable_id: "button:a" });
    expect(rows).toHaveLength(1);
    expect(rows[0].last_seen_at).toBeGreaterThanOrEqual(firstSeenAt);
  });

  it("isolates domains — example.com and other.com use different DBs", () => {
    cache.observe(
      makeSnapshot("https://example.com/", [
        { i: "RootWebArea:r", r: "RootWebArea", n: "" },
        { i: "button:shared", r: "button", n: "X" },
      ])
    );
    cache.observe(
      makeSnapshot("https://other.com/", [
        { i: "RootWebArea:r", r: "RootWebArea", n: "" },
        { i: "link:only-other", r: "link", n: "Y" },
      ])
    );
    expect(cache.query("example.com", { stable_id: "button:shared" })).toHaveLength(1);
    expect(cache.query("example.com", { stable_id: "link:only-other" })).toHaveLength(0);
    expect(cache.query("other.com", { stable_id: "link:only-other" })).toHaveLength(1);
    expect(cache.query("other.com", { stable_id: "button:shared" })).toHaveLength(0);
  });

  it("close() releases all DB file handles and rejects subsequent operations", () => {
    cache.observe(
      makeSnapshot("https://example.com/", [
        { i: "RootWebArea:r", r: "RootWebArea", n: "" },
      ])
    );
    cache.close();
    expect(() =>
      cache.observe(
        makeSnapshot("https://example.com/", [
          { i: "RootWebArea:r", r: "RootWebArea", n: "" },
        ])
      )
    ).toThrow(/closed/i);
  });

  it("ignores observations from invalid URLs without throwing", () => {
    expect(() =>
      cache.observe(
        makeSnapshot("not-a-url", [{ i: "RootWebArea:r", r: "RootWebArea", n: "" }])
      )
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Confirm fail**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/cache/site-graph.test.ts 2>&1 | tail -10
```

Expected: FAIL — module `../../src/cache/site-graph.js` not found.

- [ ] **Step 3: Implement SiteGraphCache**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/cache/site-graph.ts`:

```typescript
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { applySchema } from "./schema.js";
import { normalizeDomain, isValidDomain } from "./domain.js";
import { normalizeName } from "../snapshot/stable-id.js";
import type { Snapshot, SnapshotNode } from "../snapshot/types.js";
import type { QueryCriteria, SiteGraphConfig, SiteGraphRow } from "./types.js";

/**
 * Per-domain persistent observation store.
 *
 * Each domain Husk has ever interacted with gets its own SQLite file at
 * `{cacheDir}/{domain}.db`. On every snapshot capture, the orchestrator
 * calls `observe(snapshot)` to upsert every node's (stable_id, role,
 * name_norm, xpath, timestamp) into the per-domain DB.
 *
 * Connections are pooled by domain and stay open for the lifetime of the
 * cache. `close()` drains and closes all of them.
 *
 * v0 usage: M5 watchdog will call `query(domain, criteria)` to generate
 * candidate suggestions in rejection envelopes. M9 DOM-drift router will
 * use the same store with cross-deploy resolution semantics.
 */
export class SiteGraphCache {
  private readonly cacheDir: string;
  private readonly connections = new Map<string, Database.Database>();
  private closed = false;

  constructor(config: SiteGraphConfig) {
    this.cacheDir = config.cacheDir;
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Walk a snapshot tree and upsert every node's metadata into the
   * domain DB derived from `snapshot.url`. Cheap: ~10K upserts/sec on
   * commodity hardware, snapshot trees are typically 50-300 nodes.
   *
   * Silently no-ops if `snapshot.url` does not parse as a URL or its
   * normalized domain is unsafe for filesystem use.
   */
  observe(snapshot: Snapshot): void {
    if (this.closed) throw new Error("SiteGraphCache: closed");
    let domain: string;
    try {
      domain = normalizeDomain(snapshot.url);
    } catch {
      return; // invalid URL — silently ignore
    }
    if (!isValidDomain(domain)) return;

    const db = this.dbFor(domain);
    const upsert = db.prepare(
      `INSERT INTO selectors (stable_id, current_xpath, role, name_norm, last_seen_at)
       VALUES (@stable_id, @current_xpath, @role, @name_norm, @last_seen_at)
       ON CONFLICT(stable_id) DO UPDATE SET
         current_xpath = excluded.current_xpath,
         role          = excluded.role,
         name_norm     = excluded.name_norm,
         last_seen_at  = excluded.last_seen_at`
    );

    const now = Date.now();
    const tx = db.transaction((nodes: SnapshotNode[]) => {
      for (const n of nodes) {
        upsert.run({
          stable_id: n.i,
          current_xpath: null, // xpath threading deferred to v0.1
          role: n.r,
          name_norm: normalizeName(n.n),
          last_seen_at: now,
        });
      }
    });
    tx(flatten(snapshot.root));
  }

  /**
   * Query a domain's cache by criteria. Returns rows ordered by
   * last_seen_at DESC (most-recently-observed first), limited to
   * `criteria.limit` rows if specified.
   *
   * Returns an empty array if the domain has no DB yet (i.e., never
   * observed).
   */
  query(domain: string, criteria: QueryCriteria): SiteGraphRow[] {
    if (this.closed) throw new Error("SiteGraphCache: closed");
    if (!isValidDomain(domain)) return [];

    const dbPath = join(this.cacheDir, `${domain}.db`);
    if (!existsSync(dbPath) && !this.connections.has(domain)) return [];

    const db = this.dbFor(domain);
    const wheres: string[] = [];
    const params: Record<string, string> = {};
    if (criteria.stable_id !== undefined) {
      wheres.push("stable_id = @stable_id");
      params.stable_id = criteria.stable_id;
    }
    if (criteria.role !== undefined) {
      wheres.push("role = @role");
      params.role = criteria.role;
    }
    if (criteria.name_norm !== undefined) {
      wheres.push("name_norm = @name_norm");
      params.name_norm = criteria.name_norm;
    }
    const where = wheres.length ? "WHERE " + wheres.join(" AND ") : "";
    const limit = criteria.limit ? `LIMIT ${Math.max(0, Math.floor(criteria.limit))}` : "";
    const sql = `SELECT * FROM selectors ${where} ORDER BY last_seen_at DESC ${limit}`;
    const stmt = db.prepare(sql);
    return stmt.all(params) as SiteGraphRow[];
  }

  /** Close all open per-domain databases. Idempotent. */
  close(): void {
    if (this.closed) return;
    for (const db of this.connections.values()) {
      db.close();
    }
    this.connections.clear();
    this.closed = true;
  }

  private dbFor(domain: string): Database.Database {
    const existing = this.connections.get(domain);
    if (existing) return existing;
    const dbPath = join(this.cacheDir, `${domain}.db`);
    const db = new Database(dbPath);
    applySchema(db);
    this.connections.set(domain, db);
    return db;
  }
}

function flatten(root: SnapshotNode): SnapshotNode[] {
  const out: SnapshotNode[] = [];
  const walk = (n: SnapshotNode): void => {
    out.push(n);
    for (const c of n.c ?? []) walk(c);
  };
  walk(root);
  return out;
}
```

- [ ] **Step 4: Run test, confirm pass**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test tests/cache/site-graph.test.ts 2>&1 | tail -15
```

Expected: PASS (10 tests).

- [ ] **Step 5: Full suite**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -10
```

Expected: 106 tests pass (79 from M3 + 12 + 5 + 10 = 106). Adjust if your prior count differed.

- [ ] **Step 6: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/src/cache/site-graph.ts orchestrator/tests/cache/site-graph.test.ts
git commit -m "feat(cache): SiteGraphCache — per-domain SQLite observation store"
```

---

### Task 5: Wire SiteGraphCache into Session + SessionManager + husk start

**Files:**
- Modify: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/session/session.ts` (add `siteGraph` option; observe after snapshot)
- Modify: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/session/manager.ts` (factory passes siteGraph through)
- Modify: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/src/index.ts` (`husk start` constructs a SiteGraphCache)

- [ ] **Step 1: Read session.ts and understand the snapshot method**

```sh
cat /Users/nirmalghinaiya/Desktop/husk/orchestrator/src/session/session.ts
```

Find `async snapshot()`. After `this.lastSnapshot = snap;`, we'll add an observation call to the (optional) site graph cache.

- [ ] **Step 2: Modify session.ts**

Read the file, then make these surgical changes:

1. Add `SiteGraphCache` import:
   ```typescript
   import type { SiteGraphCache } from "../cache/site-graph.js";
   ```

2. Add to `SessionOptions`:
   ```typescript
   /** Optional cache the session will write observations to after every snapshot. */
   siteGraph?: SiteGraphCache;
   ```

3. Add private field + constructor parameter for `siteGraph`. The class currently has a private constructor `private constructor(engine, cdp, sessionId, currentUrl, lastSnapshot = null)`. Add `private readonly siteGraph: SiteGraphCache | null = null` at the end of the parameter list. Default null.

4. In `Session.create()`, accept `opts.siteGraph` and pass it to the constructor: `return new Session(engine, cdp, sessionId, "about:blank", null, opts.siteGraph ?? null);`

5. In `async snapshot()`, after `this.lastSnapshot = snap;`, add:
   ```typescript
   this.siteGraph?.observe(snap);
   ```

The full reformulated session.ts after these changes should preserve all existing behavior and add the optional siteGraph wiring. Replace the file with this complete version (you'll need to read the current file first to merge in any minor edits you don't see here):

Read the file once with `cat`, then apply the changes manually. The critical additions are listed above.

- [ ] **Step 3: Modify session/manager.ts**

The current `SessionManager` constructor takes a `SessionFactory`. We don't need to change its API — the factory CALLER (in `index.ts`) just passes `{ siteGraph }` when invoking `Session.create`. So `manager.ts` doesn't change in this task. Skip and proceed.

- [ ] **Step 4: Modify orchestrator/src/index.ts**

Read the file, find `async function runServer(args: StartArgs)`. Currently it creates a SessionManager with `() => Session.create({ log: ... })`. Modify to construct a SiteGraphCache once and pass it through:

Add import:
```typescript
import { SiteGraphCache } from "./cache/site-graph.js";
import { homedir } from "node:os";
import { join as pathJoin } from "node:path";
```

Inside `runServer`, before creating the SessionManager:
```typescript
const cacheDir = process.env.HUSK_CACHE_DIR ?? pathJoin(homedir(), ".husk", "site-graph");
const siteGraph = new SiteGraphCache({ cacheDir });
```

Change the SessionManager factory to pass siteGraph through:
```typescript
const sessions = new SessionManager(() =>
  Session.create({
    log: (l) => process.stderr.write(l + "\n"),
    siteGraph,
  })
);
```

Update the shutdown handler to close the siteGraph too:
```typescript
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  server.log.info({ signal }, "husk: shutting down");
  await sessions.closeAll();
  siteGraph.close();
  await server.stop();
  process.exit(0);
};
```

- [ ] **Step 5: Build + typecheck**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 6: Full test suite (no regression)**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -10
```

Expected: 106 tests still pass (the session.ts addition is invoked-only-when-siteGraph-is-set, which is `null` in existing tests).

- [ ] **Step 7: Smoke-test husk start writes to cache dir**

```sh
HUSK_CACHE_DIR=/tmp/husk-cache-test \
  rm -rf /tmp/husk-cache-test && \
  node /Users/nirmalghinaiya/Desktop/husk/orchestrator/dist/index.js start --port 7780 --log-level error > /tmp/husk-srv.log 2>&1 &
HUSK_PID=$!
sleep 2
# Health check (no session yet → no DB written)
curl -s -X POST http://127.0.0.1:7780/v1/jsonrpc \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"health"}'
echo ""
echo "=== Cache dir state before any session ==="
ls -la /tmp/husk-cache-test/ 2>/dev/null || echo "(not yet created)"
kill $HUSK_PID 2>/dev/null; wait $HUSK_PID 2>/dev/null
```

You should see the health response succeed. The cache dir should be created (the SiteGraphCache constructor `mkdirSync({recursive:true})`s it).

- [ ] **Step 8: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/src/session/session.ts orchestrator/src/index.ts
git commit -m "feat(cache): wire SiteGraphCache into Session + husk start"
```

---

### Task 6: Integration test — real lightpanda snapshot → cache write → query

**Files:**
- Create: `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/integration/site-graph-e2e.test.ts`

End-to-end check: start a real lightpanda subprocess, snapshot the test fixture, then verify the SiteGraphCache observed the snapshot's stable_ids in the expected per-domain DB. Skips without lightpanda binary.

- [ ] **Step 1: Write the test**

Create `/Users/nirmalghinaiya/Desktop/husk/orchestrator/tests/integration/site-graph-e2e.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../../src/session/session.js";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { locateLightpanda } from "../../src/engine/binary.js";
import { startFixtureServer } from "./fixture-server.js";

const integrationOrSkip = await (async () => {
  try {
    await locateLightpanda();
    return describe;
  } catch {
    return describe.skip;
  }
})();

integrationOrSkip("site graph cache — real lightpanda → snapshot → cache", () => {
  it("writes per-domain DB and queryable rows after Session.snapshot()", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "husk-sg-e2e-"));
    const cache = new SiteGraphCache({ cacheDir });
    const fixture = await startFixtureServer();
    let session: Session | undefined;

    try {
      session = await Session.create({ readinessTimeoutMs: 15_000, siteGraph: cache });
      await session.goto(fixture.url);
      const snap = await session.snapshot();
      expect(snap.count).toBeGreaterThan(0);

      // The fixture URL is http://127.0.0.1:N/ — domain is "127.0.0.1"
      const rows = cache.query("127.0.0.1", { role: "button" });
      expect(rows.length).toBeGreaterThan(0);
      // The fixture has a "Submit Application" button. Find it.
      const submit = rows.find((r) => r.name_norm.includes("submit"));
      expect(submit).toBeDefined();
      expect(submit?.stable_id).toMatch(/^button:/);
    } finally {
      await session?.close();
      await fixture.close();
      cache.close();
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 30_000);
});
```

- [ ] **Step 2: Build + run integration test**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm build 2>&1 | tail -3
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  pnpm test tests/integration/site-graph-e2e.test.ts 2>&1 | tail -15
```

Expected: PASS (1 test) if lightpanda binary is at the standard spike location. Skips otherwise.

- [ ] **Step 3: Full suite — confirm no regression**

```sh
cd /Users/nirmalghinaiya/Desktop/husk/orchestrator && pnpm test 2>&1 | tail -8
```

Expected: 106 unit tests pass; 3 integration tests skipped (without binary in default env).

- [ ] **Step 4: Commit**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add orchestrator/tests/integration/site-graph-e2e.test.ts
git commit -m "feat(cache): integration test — real lightpanda snapshot writes to site graph"
```

---

### Task 7: Documentation + smoke + tag

**Files:**
- Modify: `/Users/nirmalghinaiya/Desktop/husk/docs/quickstart.md` (note the cache directory + HUSK_CACHE_DIR env var)
- Modify: `/Users/nirmalghinaiya/Desktop/husk/README.md` (update "What's Shipping in v0" — site graph cache moves from "planned" to ✅)

- [ ] **Step 1: Read and update README's "What's Shipping in v0" table**

Find `## What's Shipping in v0` in `/Users/nirmalghinaiya/Desktop/husk/README.md`. Currently the v0 status table doesn't explicitly list "site graph cache" — but Snapshot compression and Watchdog are listed. The table doesn't need a new row; instead, update the "DOM-drift router (cross-deploy resolver)" row's status from "v0.1" to "v0.3 / M9 (site graph foundation lands in v0 / M4)" to reflect the new sequencing.

Actually, simpler: the readme doesn't strictly need to change for M4. The site graph is plumbing that future milestones consume. Skip and proceed if the README is already accurate enough.

If you want to add explicit M4 visibility, add this row to the table after "Snapshot compression":

```markdown
| Site graph cache (per-domain SQLite observation store; M5/M9 consume it) | ✅ |
```

- [ ] **Step 2: Add a `HUSK_CACHE_DIR` note to docs/quickstart.md**

Find the "Run the HTTP server" section in `/Users/nirmalghinaiya/Desktop/husk/docs/quickstart.md`. After the example flow, append:

```markdown

## Where Husk stores per-domain observations

Every time the orchestrator captures a snapshot, it writes every node's
metadata (stable_id, role, accessible name, timestamp) into a
per-domain SQLite database at `~/.husk/site-graph/{domain}.db`. The
M5 watchdog will use this cache to generate candidate suggestions when
your agent references an element that no longer exists.

To use a different directory (e.g., for tests or isolated dev):

```sh
HUSK_CACHE_DIR=/tmp/my-husk-cache \
  node ./orchestrator/dist/index.js start --port 7777
```

To clear everything Husk has ever seen on a particular domain:

```sh
rm ~/.husk/site-graph/example.com.db
```

The cache is observation-only in v0 — it doesn't gate behavior. M5
(watchdog) reads from it for rejection-envelope candidate generation,
and M9 (DOM-drift router) will use it for cross-deploy stable-ID
resolution. v1.0 vertical recipes are pre-populated site graphs you'll
be able to ship alongside Husk.
```

(Use real triple-backticks in the file. The `\`\`\`` above is markdown shorthand to delimit the example.)

- [ ] **Step 3: Commit docs**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git add docs/quickstart.md README.md
git commit -m "docs: site graph cache + HUSK_CACHE_DIR env var"
```

- [ ] **Step 4: End-to-end smoke from clean**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
make clean 2>&1 | tail -3
pnpm install 2>&1 | tail -3
make all 2>&1 | tail -8
make test 2>&1 | grep -E "(passed|Tests|Files|skipped)" | tail -10
```

Expected: ~ 130+ tests passing (106 orchestrator + 33 mcp + 4 sdk-ts + 4 sdk-py + 3 integration skipped without binary).

- [ ] **Step 5: Optional manual smoke (only if lightpanda binary is local)**

```sh
test -x /Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda && \
  HUSK_CACHE_DIR=/tmp/husk-m4-smoke \
  LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  rm -rf /tmp/husk-m4-smoke && \
  node /Users/nirmalghinaiya/Desktop/husk/orchestrator/dist/index.js start --port 7779 --log-level error > /tmp/m4-smoke.log 2>&1 &
HUSK_PID=$!
sleep 2

# Create a session, navigate, snapshot — exercises the cache observe path
RPC=http://127.0.0.1:7779/v1/jsonrpc
SID=$(curl -s -X POST $RPC -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"create_session"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['session_id'])")
echo "session_id=$SID"

curl -s -X POST $RPC -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"goto\",\"params\":{\"session_id\":\"$SID\",\"url\":\"https://example.com/\"}}" > /dev/null
curl -s -X POST $RPC -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"snapshot\",\"params\":{\"session_id\":\"$SID\"}}" > /dev/null

ls -la /tmp/husk-m4-smoke/
echo "=== sqlite contents ==="
sqlite3 /tmp/husk-m4-smoke/example.com.db "SELECT stable_id, role, name_norm FROM selectors LIMIT 10" 2>&1 || echo "(sqlite3 cli not installed; cache file exists)"

kill $HUSK_PID 2>/dev/null; wait $HUSK_PID 2>/dev/null
```

You should see a fresh `example.com.db` file with observed rows.

- [ ] **Step 6: Tag**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
git tag -a v0.0.5-m4 -m "Milestone 4 (site graph cache) complete: per-domain SQLite observation store"
git tag --list | tail -5
```

- [ ] **Step 7: Summary**

```sh
cd /Users/nirmalghinaiya/Desktop/husk
echo "=== M4 commits ==="
git log --oneline main..HEAD
echo ""
echo "=== Final test count ==="
make test 2>&1 | grep -E "(passed|Tests|Files|skipped)" | tail -10
```

---

## Definition of Done

- [ ] All 7 tasks committed on branch `m4-site-graph`
- [ ] `make clean && pnpm install && make all` exits 0
- [ ] `pnpm test` in `orchestrator/` shows ≥ 106 unit tests + 3 integration tests (skipped or passing based on lightpanda availability)
- [ ] `husk start` creates `~/.husk/site-graph/` on startup (or the override directory via HUSK_CACHE_DIR)
- [ ] After a full create_session → goto → snapshot flow against `https://example.com/`, an `example.com.db` file exists in the cache dir with at least one row
- [ ] `protocol/jsonrpc.openapi.yaml` is unchanged (M4 adds no public protocol surface — that's M5)
- [ ] Tag `v0.0.5-m4` exists
- [ ] No code changes outside `orchestrator/`, `docs/quickstart.md`, optionally `README.md`

If any DoD checkbox fails, the milestone is not complete; address the gap before merging to main.

---

## What's NOT in this plan (deferred)

- **Fuzzy resolver** (role+name → closest cached element) — M5 (watchdog candidate generation)
- **Cross-page-load stable-ID stability** — M9 (DOM-drift router; needs real DOM xpaths, not synthetic a11y-tree paths)
- **Hit/miss tracking** — wired in M5 when the cache becomes load-bearing for action resolution
- **Cookie + session storage** in the same per-domain DB — M8 auth pillar (will add a `cookies` table alongside `selectors`)
- **Vertical recipes** (pre-populated cache files for Aetna / UnitedHealth / etc.) — M11
- **Public Suffix List handling** (treating `co.uk` as a TLD) — v0.3+ if real-world clashes appear
- **Cache size limits / eviction** — v0.3 cloud milestone

When this plan ships, the next plan is **Plan #6 — M5 (watchdog + action planner)** — the deterministic safety floor and action primitives that turn Husk into a real agent-driving tool. M5 reads the site graph cache for candidate generation in rejection envelopes. M5 is *the wedge*.
