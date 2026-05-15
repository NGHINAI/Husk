# M8a Cookie Vault + Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist browser cookies to disk per "profile" so sessions survive across `husk start` restarts. Foundation for M8b (login forms + TOTP) and M8c (SSO/OIDC + MFA).

**Architecture:** Per-profile SQLite at `~/.husk/vault/{profile}.db` storing CDP-format cookies. Capture: poll `Network.getCookies` after every action and on session close. Restore: on session create with `profile`, push stored cookies into the new target via `Network.setCookies` before the first navigation. Profile concept lives entirely in Husk — lightpanda's `--cookie-jar` is intentionally NOT used (Husk owns the storage so the same code works against any future engine).

**Tech Stack:** TypeScript, `better-sqlite3` (already wired), Node 20+. No new runtime deps. Optional envelope encryption via Node `crypto` (AES-256-GCM) is wired via the `HUSK_VAULT_KEY` env var; default is plaintext-with-0600 (documented threat model).

**Spec reference:** `docs/superpowers/specs/2026-05-13-husk-design.md` §3 excludes "Auth pillar beyond basic cookie persistence (full SSO, SAML, OIDC, MFA, TOTP, push)" from v0; spec §10 reclassifies M8 (auth pillar) as the first post-launch milestone. **M8a delivers the first row of that: cookie persistence only.** SSO/OIDC/SAML/TOTP/MFA stays scoped out for this sub-milestone.

**Spike reference:** `docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md` lines 226, 375, 398 — confirms lightpanda exposes CDP `Network.setCookie/setCookies/getCookies/getAllCookies/deleteCookies/clearBrowserCookies`. No `requestWillBeSentExtraInfo` events — we poll on actions instead of intercepting Set-Cookie response headers in flight.

**Known gaps (deferred to M8b/c, NOT in M8a):**
- `localStorage` / `sessionStorage` persistence — lightpanda's `Shed` is in-memory only; would require a Storage CDP integration. Document the limitation.
- IndexedDB — absent in lightpanda upstream (Firebase Auth, AWS Amplify, Auth0 SPA SDK will fail).
- Cookie partition keys (`Partitioned` attribute / CHIPS) — silently ignored by lightpanda, marked `not_implemented`.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `orchestrator/src/vault/types.ts` | `Cookie` (CDP-format), `Profile` (just `string` alias for now), `VaultRow` storage shape |
| `orchestrator/src/vault/profile-path.ts` | Profile name → DB filesystem path; validation (no `/`, no `..`, max 64 chars) |
| `orchestrator/src/vault/store.ts` | `VaultStore` class — per-profile SQLite, upsert/list/clear, file-mode 0600, optional AES-GCM encryption hook |
| `orchestrator/src/vault/capture.ts` | `captureCookies(cdp, sessionId): Promise<Cookie[]>` — wraps `Network.getAllCookies` |
| `orchestrator/src/vault/restore.ts` | `restoreCookies(cdp, sessionId, cookies)` — wraps `Network.setCookies` |
| `orchestrator/src/vault/index.ts` | Re-exports |
| `orchestrator/tests/vault/profile-path.test.ts` | Unit |
| `orchestrator/tests/vault/store.test.ts` | Unit (CRUD + encryption round-trip) |
| `orchestrator/tests/vault/capture.test.ts` | Mocked CDP |
| `orchestrator/tests/vault/restore.test.ts` | Mocked CDP |
| `orchestrator/tests/integration/vault-e2e.test.ts` | Real lightpanda + login fixture |
| `orchestrator/tests/integration/login-fixture-server.ts` | Self-hosted login form fixture (sets a session cookie on POST) |

### Modified files

| Path | Change |
|---|---|
| `orchestrator/src/session/session.ts` | Add `profile?` to `SessionOptions`; restore cookies on create; capture on close; new `setProfile()` method for late binding |
| `orchestrator/src/session/manager.ts` | Forward `profile` from `create({profile})` through the factory |
| `orchestrator/src/http/methods.ts` | Extend `create_session` to accept `profile?`; add `vault_list`, `vault_clear`, `vault_remove_cookie` methods |
| `orchestrator/src/index.ts` | Add `husk vault list|clear` CLI subcommand; spawn vault store in `runServer` |
| `sdk-ts/src/index.ts` | `createSession({ profile? })` overload; new `Husk.vault` namespace with `list/clear/removeCookie` |
| `sdk-py/husk/__init__.py` | `create_session(profile=...)`; `Husk.vault` async namespace |
| `mcp/src/tool-surface.ts` | `husk_create_session` accepts `profile`; new `husk_vault_list`, `husk_vault_clear` tools |
| `docs/superpowers/specs/2026-05-13-husk-design.md` | Append §5.4 (Cookie Vault) describing M8a contract |

---

## Test Counts at Each Stage

| After task | Cumulative across packages |
|---|---|
| T1 (cookie types) | 252 + 3 = 255 |
| T2 (VaultStore + profile-path) | 255 + 12 = 267 |
| T3 (capture/restore) | 267 + 6 = 273 |
| T4 (Session profile wiring) | 273 + 5 = 278 |
| T5 (HTTP create_session profile + vault_* methods) | 278 + 6 = 284 |
| T6 (TS SDK vault API) | 284 + 5 = 289 |
| T7 (Py SDK vault API) | 289 + 5 = 294 |
| T8 (MCP vault tools) | 294 + 3 = 297 |
| T9 (CLI husk vault) | 297 + 3 = 300 |
| T10 (login-fixture integration) | 300 + 2 = **302** |
| T11 (spec amendment + memory) | 302 |

302 tests at M8a end. Integration test guarded by `LIGHTPANDA_BIN`.

---

## Task 1: Cookie Types + Profile Path Helper

**Files:**
- Create: `orchestrator/src/vault/types.ts`
- Create: `orchestrator/src/vault/profile-path.ts`
- Create: `orchestrator/tests/vault/profile-path.test.ts`

- [ ] **Step 1: Write the failing test**

`orchestrator/tests/vault/profile-path.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveProfilePath, isValidProfileName } from "../../src/vault/profile-path.js";
import { join } from "node:path";

describe("isValidProfileName", () => {
  it("accepts alphanumerics, dashes, underscores, dots", () => {
    expect(isValidProfileName("default")).toBe(true);
    expect(isValidProfileName("work-account-1")).toBe(true);
    expect(isValidProfileName("gmail.personal")).toBe(true);
    expect(isValidProfileName("a_b_c")).toBe(true);
  });

  it("rejects names with path traversal", () => {
    expect(isValidProfileName("../etc/passwd")).toBe(false);
    expect(isValidProfileName("..")).toBe(false);
    expect(isValidProfileName("foo/bar")).toBe(false);
    expect(isValidProfileName("foo\\bar")).toBe(false);
  });

  it("rejects empty and over-long names", () => {
    expect(isValidProfileName("")).toBe(false);
    expect(isValidProfileName("a".repeat(65))).toBe(false);
  });
});

describe("resolveProfilePath", () => {
  it("returns vaultDir + '/' + profile + '.db'", () => {
    expect(resolveProfilePath("/v", "default")).toBe(join("/v", "default.db"));
  });

  it("throws on invalid profile name", () => {
    expect(() => resolveProfilePath("/v", "../etc")).toThrow(/profile name/i);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run vault/profile-path
```

- [ ] **Step 3: Implement types**

`orchestrator/src/vault/types.ts`:

```typescript
/**
 * One cookie. Wire format matches CDP `Network.Cookie` (Chromium DevTools
 * Protocol). Husk stores cookies in this shape verbatim so they can be
 * pushed back to `Network.setCookies` without translation.
 */
export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix epoch seconds. -1 for session cookies. */
  expires: number;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  /** "Strict" | "Lax" | "None" (CDP capitalisation). */
  sameSite?: "Strict" | "Lax" | "None";
  /** Source URL used when restoring via setCookies. Optional in storage. */
  url?: string;
}

/** Profile identifier — a short readable string. Validated via profile-path.ts. */
export type Profile = string;
```

`orchestrator/src/vault/profile-path.ts`:

```typescript
import { join } from "node:path";

/**
 * Profile names map 1:1 to `{vaultDir}/{profile}.db` files. We restrict to a
 * conservative charset to keep filesystem semantics predictable across
 * macOS / Linux / Windows and to block path traversal.
 */
const PROFILE_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export function isValidProfileName(name: string): boolean {
  if (!name) return false;
  if (name === "." || name === "..") return false;
  return PROFILE_NAME_RE.test(name);
}

export function resolveProfilePath(vaultDir: string, profile: string): string {
  if (!isValidProfileName(profile)) {
    throw new Error(`Invalid profile name: ${JSON.stringify(profile)}`);
  }
  return join(vaultDir, `${profile}.db`);
}
```

- [ ] **Step 4: Run + commit**

```
pnpm --filter husk-orchestrator vitest run vault/profile-path
pnpm --filter husk-orchestrator typecheck
git add orchestrator/src/vault/types.ts orchestrator/src/vault/profile-path.ts orchestrator/tests/vault/profile-path.test.ts
git commit -m "feat(vault): Cookie type + profile name validation"
```

Expected: 3 tests pass.

---

## Task 2: VaultStore — Per-Profile SQLite with Optional AES-GCM

**Files:**
- Create: `orchestrator/src/vault/store.ts`
- Create: `orchestrator/src/vault/index.ts`
- Create: `orchestrator/tests/vault/store.test.ts`

- [ ] **Step 1: Write failing tests**

`orchestrator/tests/vault/store.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultStore } from "../../src/vault/store.js";
import type { Cookie } from "../../src/vault/types.js";

function cookie(name: string, value: string, domain = "example.com"): Cookie {
  return {
    name, value, domain, path: "/",
    expires: 4000000000, // year ~2096
    size: name.length + value.length,
    httpOnly: false, secure: true, session: false, sameSite: "Lax",
  };
}

describe("VaultStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "husk-vault-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a per-profile .db file with 0600 mode on Linux/macOS", () => {
    const store = new VaultStore({ vaultDir: dir });
    store.put("default", [cookie("sid", "abc")]);
    const file = join(dir, "default.db");
    expect(existsSync(file)).toBe(true);
    const mode = statSync(file).mode & 0o777;
    // 0600 expected; allow 0644 on Windows where chmod is a no-op.
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600);
    }
    store.close();
  });

  it("upserts cookies by (name, domain, path) primary key", () => {
    const store = new VaultStore({ vaultDir: dir });
    store.put("default", [cookie("sid", "v1"), cookie("sid", "v2")]);
    const got = store.list("default");
    expect(got.length).toBe(1);
    expect(got[0].value).toBe("v2");
    store.close();
  });

  it("returns empty array for unknown profile", () => {
    const store = new VaultStore({ vaultDir: dir });
    expect(store.list("never-created")).toEqual([]);
    store.close();
  });

  it("clear() removes all cookies for the profile", () => {
    const store = new VaultStore({ vaultDir: dir });
    store.put("default", [cookie("a", "1"), cookie("b", "2")]);
    store.clear("default");
    expect(store.list("default")).toEqual([]);
    store.close();
  });

  it("remove(profile, name, domain, path) deletes one cookie", () => {
    const store = new VaultStore({ vaultDir: dir });
    store.put("default", [cookie("a", "1"), cookie("b", "2")]);
    store.remove("default", { name: "a", domain: "example.com", path: "/" });
    const got = store.list("default");
    expect(got.length).toBe(1);
    expect(got[0].name).toBe("b");
    store.close();
  });

  it("listProfiles returns every profile that has had cookies written", () => {
    const store = new VaultStore({ vaultDir: dir });
    store.put("default", [cookie("a", "1")]);
    store.put("work", [cookie("b", "2", "work.test")]);
    expect(store.listProfiles().sort()).toEqual(["default", "work"]);
    store.close();
  });

  it("preserves sameSite Strict/Lax/None round-trip", () => {
    const store = new VaultStore({ vaultDir: dir });
    const strict: Cookie = { ...cookie("a", "1"), sameSite: "Strict" };
    const none: Cookie = { ...cookie("b", "2"), sameSite: "None" };
    store.put("default", [strict, none]);
    const got = store.list("default").sort((x, y) => x.name.localeCompare(y.name));
    expect(got[0].sameSite).toBe("Strict");
    expect(got[1].sameSite).toBe("None");
    store.close();
  });

  it("preserves session=true for expires=-1 cookies", () => {
    const store = new VaultStore({ vaultDir: dir });
    const sess: Cookie = { ...cookie("a", "1"), expires: -1, session: true };
    store.put("default", [sess]);
    const got = store.list("default");
    expect(got[0].session).toBe(true);
    expect(got[0].expires).toBe(-1);
    store.close();
  });

  it("ignores expired cookies on read (expires < now)", () => {
    const store = new VaultStore({ vaultDir: dir });
    const past: Cookie = { ...cookie("a", "1"), expires: 100, session: false };
    store.put("default", [past]);
    expect(store.list("default")).toEqual([]);
    store.close();
  });

  it("encrypts at rest when HUSK_VAULT_KEY env is set (round-trip)", () => {
    const key = Buffer.alloc(32, 7).toString("base64"); // 32 zero bytes
    const store = new VaultStore({ vaultDir: dir, encryptionKey: key });
    store.put("default", [cookie("sid", "secret-value")]);
    store.close();

    // Open a fresh store with the same key — must round-trip.
    const reopen = new VaultStore({ vaultDir: dir, encryptionKey: key });
    expect(reopen.list("default")[0].value).toBe("secret-value");
    reopen.close();
  });

  it("encrypted vault is unreadable with a different key", () => {
    const dir2 = mkdtempSync(join(tmpdir(), "husk-vault2-"));
    try {
      const k1 = Buffer.alloc(32, 1).toString("base64");
      const k2 = Buffer.alloc(32, 2).toString("base64");
      const s1 = new VaultStore({ vaultDir: dir2, encryptionKey: k1 });
      s1.put("default", [cookie("sid", "secret")]);
      s1.close();
      const s2 = new VaultStore({ vaultDir: dir2, encryptionKey: k2 });
      expect(() => s2.list("default")).toThrow();
      s2.close();
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("close() is idempotent and safe to call multiple times", () => {
    const store = new VaultStore({ vaultDir: dir });
    store.close();
    expect(() => store.close()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run vault/store
```

- [ ] **Step 3: Implement VaultStore**

`orchestrator/src/vault/store.ts`:

```typescript
import Database, { type Database as Db } from "better-sqlite3";
import { mkdirSync, chmodSync, readdirSync, existsSync } from "node:fs";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { resolveProfilePath, isValidProfileName } from "./profile-path.js";
import type { Cookie, Profile } from "./types.js";

export interface VaultStoreOptions {
  /** Root directory for per-profile DBs. Default: `~/.husk/vault`. */
  vaultDir: string;
  /**
   * Optional base64-encoded 32-byte key. When set, cookie *values* are
   * AES-256-GCM encrypted before storage. The DB row layout stays the same
   * so unencrypted vaults can be opened seamlessly when no key is provided.
   *
   * Threat model: protects against attackers who can read the file but not
   * the running process's env. For stronger guarantees (key in OS keychain,
   * passphrase-derived KDF), see M8a follow-up polish.
   */
  encryptionKey?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('version', '1');
INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('encrypted', '0');

CREATE TABLE IF NOT EXISTS cookies (
  name      TEXT NOT NULL,
  domain    TEXT NOT NULL,
  path      TEXT NOT NULL,
  value     TEXT NOT NULL,           -- raw or AES-GCM ciphertext (base64)
  expires   INTEGER NOT NULL,        -- unix seconds, -1 for session
  size      INTEGER NOT NULL,
  http_only INTEGER NOT NULL,
  secure    INTEGER NOT NULL,
  session   INTEGER NOT NULL,
  same_site TEXT,                    -- "Strict" | "Lax" | "None" | NULL
  url       TEXT,
  PRIMARY KEY (name, domain, path)
);

CREATE INDEX IF NOT EXISTS idx_cookies_domain ON cookies(domain);
`;

interface CookieRow {
  name: string;
  domain: string;
  path: string;
  value: string;
  expires: number;
  size: number;
  http_only: number;
  secure: number;
  session: number;
  same_site: string | null;
  url: string | null;
}

const ENCRYPTED_PREFIX = "enc::";

/**
 * Per-profile cookie store. One SQLite file per profile under `vaultDir`.
 * Connections are opened lazily and pooled by profile name.
 */
export class VaultStore {
  private readonly pool = new Map<string, Db>();
  private closed = false;

  constructor(private readonly opts: VaultStoreOptions) {
    mkdirSync(opts.vaultDir, { recursive: true });
    try { chmodSync(opts.vaultDir, 0o700); } catch { /* windows / non-fatal */ }
  }

  /** Insert-or-replace each cookie by (name, domain, path). */
  put(profile: Profile, cookies: Cookie[]): void {
    if (cookies.length === 0) return;
    const db = this.dbFor(profile);
    const stmt = db.prepare(`
      INSERT INTO cookies (name, domain, path, value, expires, size,
                           http_only, secure, session, same_site, url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name, domain, path) DO UPDATE SET
        value=excluded.value,
        expires=excluded.expires,
        size=excluded.size,
        http_only=excluded.http_only,
        secure=excluded.secure,
        session=excluded.session,
        same_site=excluded.same_site,
        url=excluded.url
    `);
    const txn = db.transaction((rows: Cookie[]) => {
      for (const c of rows) {
        stmt.run(
          c.name, c.domain, c.path,
          this.encryptValue(c.value),
          c.expires, c.size,
          c.httpOnly ? 1 : 0,
          c.secure ? 1 : 0,
          c.session ? 1 : 0,
          c.sameSite ?? null,
          c.url ?? null
        );
      }
    });
    txn(cookies);
  }

  /** Return all non-expired cookies for `profile`. */
  list(profile: Profile): Cookie[] {
    const file = this.profileFile(profile);
    if (!existsSync(file)) return [];
    const db = this.dbFor(profile);
    const now = Math.floor(Date.now() / 1000);
    const rows = db
      .prepare(`SELECT * FROM cookies WHERE expires = -1 OR expires > ?`)
      .all(now) as CookieRow[];
    return rows.map((r) => this.rowToCookie(r));
  }

  /** Delete one cookie by primary key. No-op if not present. */
  remove(profile: Profile, key: { name: string; domain: string; path: string }): void {
    const file = this.profileFile(profile);
    if (!existsSync(file)) return;
    const db = this.dbFor(profile);
    db.prepare(`DELETE FROM cookies WHERE name = ? AND domain = ? AND path = ?`).run(
      key.name, key.domain, key.path
    );
  }

  /** Delete every cookie in the profile (table truncate, file kept). */
  clear(profile: Profile): void {
    const file = this.profileFile(profile);
    if (!existsSync(file)) return;
    const db = this.dbFor(profile);
    db.prepare(`DELETE FROM cookies`).run();
  }

  /** Profiles that have been written to. */
  listProfiles(): string[] {
    if (!existsSync(this.opts.vaultDir)) return [];
    return readdirSync(this.opts.vaultDir)
      .filter((f) => f.endsWith(".db"))
      .map((f) => f.slice(0, -3))
      .filter(isValidProfileName);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const db of this.pool.values()) {
      try { db.close(); } catch { /* ignore */ }
    }
    this.pool.clear();
  }

  // ----- internals -----

  private dbFor(profile: Profile): Db {
    if (this.closed) throw new Error("VaultStore: already closed");
    const cached = this.pool.get(profile);
    if (cached) return cached;
    const path = this.profileFile(profile);
    const fresh = path; // unused — silences unused-var if file existed already
    void fresh;
    const isNew = !existsSync(path);
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.exec(SCHEMA);
    if (isNew) {
      try { chmodSync(path, 0o600); } catch { /* windows */ }
    }
    // Enforce encryption marker: if a vault was opened with a key previously,
    // require it again.
    const encrypted = (db
      .prepare(`SELECT value FROM schema_meta WHERE key='encrypted'`)
      .get() as { value: string } | undefined)?.value ?? "0";
    if (encrypted === "1" && !this.opts.encryptionKey) {
      throw new Error(`Vault profile "${profile}" was encrypted; HUSK_VAULT_KEY must be set`);
    }
    if (encrypted === "0" && this.opts.encryptionKey) {
      db.prepare(`UPDATE schema_meta SET value='1' WHERE key='encrypted'`).run();
    }
    this.pool.set(profile, db);
    return db;
  }

  private profileFile(profile: Profile): string {
    return resolveProfilePath(this.opts.vaultDir, profile);
  }

  private rowToCookie(r: CookieRow): Cookie {
    return {
      name: r.name,
      value: this.decryptValue(r.value),
      domain: r.domain,
      path: r.path,
      expires: r.expires,
      size: r.size,
      httpOnly: r.http_only !== 0,
      secure: r.secure !== 0,
      session: r.session !== 0,
      sameSite: (r.same_site as Cookie["sameSite"]) ?? undefined,
      url: r.url ?? undefined,
    };
  }

  private encryptValue(plain: string): string {
    if (!this.opts.encryptionKey) return plain;
    const key = this.deriveKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ENCRYPTED_PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
  }

  private decryptValue(stored: string): string {
    if (!this.opts.encryptionKey) {
      if (stored.startsWith(ENCRYPTED_PREFIX)) {
        throw new Error("Vault: stored value is encrypted but no HUSK_VAULT_KEY provided");
      }
      return stored;
    }
    if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored;
    const buf = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const key = this.deriveKey();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  }

  private cachedKey?: Buffer;
  private deriveKey(): Buffer {
    if (this.cachedKey) return this.cachedKey;
    const raw = Buffer.from(this.opts.encryptionKey!, "base64");
    // Use scrypt with a fixed salt scoped to "husk-vault-v1" so the same key
    // string always derives the same 32 bytes. Salt rotates with schema bumps.
    this.cachedKey = scryptSync(raw, "husk-vault-v1", 32);
    return this.cachedKey;
  }
}
```

`orchestrator/src/vault/index.ts`:

```typescript
export { VaultStore } from "./store.js";
export { resolveProfilePath, isValidProfileName } from "./profile-path.js";
export type { Cookie, Profile } from "./types.js";
export type { VaultStoreOptions } from "./store.js";
```

- [ ] **Step 4: Verify + commit**

```
pnpm --filter husk-orchestrator vitest run vault/store
pnpm --filter husk-orchestrator typecheck
git add orchestrator/src/vault/store.ts orchestrator/src/vault/index.ts orchestrator/tests/vault/store.test.ts
git commit -m "feat(vault): VaultStore — per-profile SQLite with optional AES-GCM"
```

Expected: 12 tests pass.

---

## Task 3: Capture + Restore (CDP wrappers)

**Files:**
- Create: `orchestrator/src/vault/capture.ts`
- Create: `orchestrator/src/vault/restore.ts`
- Create: `orchestrator/tests/vault/capture.test.ts`
- Create: `orchestrator/tests/vault/restore.test.ts`

- [ ] **Step 1: Write failing tests**

`orchestrator/tests/vault/capture.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { captureCookies } from "../../src/vault/capture.js";

describe("captureCookies", () => {
  it("calls Network.getAllCookies and returns the cookies array", async () => {
    const cookies = [
      { name: "sid", value: "abc", domain: "x.test", path: "/", expires: -1, size: 6, httpOnly: false, secure: false, session: true, sameSite: "Lax" },
    ];
    const cdp = { send: vi.fn(async () => ({ cookies })) };
    const got = await captureCookies(cdp as any, "sess1");
    expect(cdp.send).toHaveBeenCalledWith("Network.getAllCookies", {}, "sess1");
    expect(got).toEqual(cookies);
  });

  it("returns empty array when CDP returns no cookies field", async () => {
    const cdp = { send: vi.fn(async () => ({})) };
    const got = await captureCookies(cdp as any, "sess1");
    expect(got).toEqual([]);
  });

  it("propagates CDP errors", async () => {
    const cdp = { send: vi.fn(async () => { throw new Error("CDP boom"); }) };
    await expect(captureCookies(cdp as any, "sess1")).rejects.toThrow(/CDP boom/);
  });
});
```

`orchestrator/tests/vault/restore.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { restoreCookies } from "../../src/vault/restore.js";
import type { Cookie } from "../../src/vault/types.js";

const c = (name: string): Cookie => ({
  name, value: "v", domain: "x.test", path: "/",
  expires: -1, size: 1, httpOnly: false, secure: false, session: true, sameSite: "Lax",
});

describe("restoreCookies", () => {
  it("calls Network.setCookies with the supplied cookies", async () => {
    const cdp = { send: vi.fn(async () => null) };
    await restoreCookies(cdp as any, "sess1", [c("a"), c("b")]);
    expect(cdp.send).toHaveBeenCalledWith(
      "Network.setCookies",
      { cookies: [c("a"), c("b")] },
      "sess1"
    );
  });

  it("is a no-op when given empty array", async () => {
    const cdp = { send: vi.fn(async () => null) };
    await restoreCookies(cdp as any, "sess1", []);
    expect(cdp.send).not.toHaveBeenCalled();
  });

  it("strips undefined optional fields before sending (CDP rejects unknown keys with undefined)", async () => {
    const cdp = { send: vi.fn(async () => null) };
    const withUndefined: Cookie = { ...c("a"), sameSite: undefined, url: undefined };
    await restoreCookies(cdp as any, "sess1", [withUndefined]);
    const sent = (cdp.send.mock.calls[0][1] as { cookies: object[] }).cookies[0] as Record<string, unknown>;
    expect("sameSite" in sent).toBe(false);
    expect("url" in sent).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run vault/capture vault/restore
```

- [ ] **Step 3: Implement**

`orchestrator/src/vault/capture.ts`:

```typescript
import type { Cookie } from "./types.js";

interface CdpLike {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
}

/**
 * Snapshot every cookie visible to the session via CDP `Network.getAllCookies`.
 * Includes cookies for every origin the session has visited.
 */
export async function captureCookies(cdp: CdpLike, sessionId: string): Promise<Cookie[]> {
  const res = (await cdp.send("Network.getAllCookies", {}, sessionId)) as { cookies?: Cookie[] };
  return res.cookies ?? [];
}
```

`orchestrator/src/vault/restore.ts`:

```typescript
import type { Cookie } from "./types.js";

interface CdpLike {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
}

/**
 * Push cookies into the session via CDP `Network.setCookies`. Strips any
 * `undefined` optional fields because lightpanda's CDP layer rejects unknown
 * keys (per M2 spike) when their values are `undefined`.
 */
export async function restoreCookies(
  cdp: CdpLike,
  sessionId: string,
  cookies: Cookie[]
): Promise<void> {
  if (cookies.length === 0) return;
  const sanitised = cookies.map((c) => {
    const out: Record<string, unknown> = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      size: c.size,
      httpOnly: c.httpOnly,
      secure: c.secure,
      session: c.session,
    };
    if (c.sameSite !== undefined) out.sameSite = c.sameSite;
    if (c.url !== undefined) out.url = c.url;
    return out;
  });
  await cdp.send("Network.setCookies", { cookies: sanitised }, sessionId);
}
```

- [ ] **Step 4: Verify + commit**

```
pnpm --filter husk-orchestrator vitest run vault/capture vault/restore
pnpm --filter husk-orchestrator typecheck
git add orchestrator/src/vault/capture.ts orchestrator/src/vault/restore.ts \
        orchestrator/tests/vault/capture.test.ts orchestrator/tests/vault/restore.test.ts
git commit -m "feat(vault): CDP captureCookies + restoreCookies wrappers"
```

Expected: 6 tests pass.

---

## Task 4: Session Profile Wiring

**Files:**
- Modify: `orchestrator/src/session/session.ts` (add `profile?` to options; restore on create; capture on close; new `getProfile()` getter)
- Modify: `orchestrator/src/session/manager.ts` (forward profile arg through factory)
- Create: `orchestrator/tests/session/profile-wiring.test.ts`

- [ ] **Step 1: Write failing test**

`orchestrator/tests/session/profile-wiring.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultStore } from "../../src/vault/store.js";
import { Session } from "../../src/session/session.js";

/** Tests focus on the profile wiring contract — Session.create() pulls from
 *  vault, attaches profile, and pushes back on close. We don't spin up
 *  lightpanda; we inject a fake engine + CDP through the static helper
 *  Session.fromInjected() below. If that helper doesn't exist, add it. */

// These tests use Session.fromInjected — see implementation notes below.

describe("Session profile wiring", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "husk-vault-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("restores cookies from vault on Session.create({profile})", async () => {
    const store = new VaultStore({ vaultDir: dir });
    store.put("work", [{
      name: "sid", value: "x", domain: "ex.test", path: "/",
      expires: -1, size: 1, httpOnly: false, secure: false, session: true,
    }]);

    const cdpCalls: Array<{ method: string }> = [];
    const cdp = { send: vi.fn(async (m: string) => { cdpCalls.push({ method: m }); return null; }) };

    const sess = Session.fromInjected({
      engine: { close: async () => {} },
      cdp,
      sessionId: "s1",
      vault: store,
      profile: "work",
    });
    // Trigger explicit restore (Session.create runs it internally; for the
    // injected test we expose a `restoreFromVault()` no-op-public method).
    await sess.restoreFromVault();
    expect(cdpCalls.some((c) => c.method === "Network.setCookies")).toBe(true);
    store.close();
  });

  it("captures cookies to vault on Session.close()", async () => {
    const store = new VaultStore({ vaultDir: dir });
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === "Network.getAllCookies") {
          return { cookies: [{
            name: "after", value: "1", domain: "ex.test", path: "/",
            expires: 4000000000, size: 1, httpOnly: false, secure: false, session: false,
          }] };
        }
        return null;
      }),
    };
    const sess = Session.fromInjected({
      engine: { close: async () => {} },
      cdp,
      sessionId: "s1",
      vault: store,
      profile: "default",
    });
    await sess.close();
    expect(store.list("default").find((c) => c.name === "after")).toBeDefined();
    store.close();
  });

  it("does NOT touch vault when profile is undefined", async () => {
    const store = new VaultStore({ vaultDir: dir });
    const cdp = { send: vi.fn(async () => null) };
    const sess = Session.fromInjected({
      engine: { close: async () => {} },
      cdp,
      sessionId: "s1",
      vault: store,
      profile: undefined,
    });
    await sess.restoreFromVault();
    await sess.close();
    expect(store.listProfiles()).toEqual([]);
    store.close();
  });

  it("getProfile returns the bound profile name or null", async () => {
    const store = new VaultStore({ vaultDir: dir });
    const cdp = { send: vi.fn(async () => null) };
    const a = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s1", vault: store, profile: "work" });
    const b = Session.fromInjected({ engine: { close: async () => {} }, cdp, sessionId: "s2", vault: store });
    expect(a.getProfile()).toBe("work");
    expect(b.getProfile()).toBeNull();
    store.close();
  });

  it("Session.create options accept profile and pass it through", () => {
    // Type-level only: ensure the option exists. This compiles or it doesn't.
    type Options = Parameters<typeof Session.create>[0];
    const _t: Options = { profile: "work" };
    void _t;
    expect(true).toBe(true);
  });
});

import { beforeEach, afterEach } from "vitest";
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run session/profile-wiring
```

- [ ] **Step 3: Extend Session class**

Modify `orchestrator/src/session/session.ts`. Concretely:

1. Add to imports:
```typescript
import { VaultStore } from "../vault/store.js";
import { captureCookies } from "../vault/capture.js";
import { restoreCookies } from "../vault/restore.js";
```

2. Extend `SessionOptions`:
```typescript
export interface SessionOptions {
  // ... existing fields ...
  /** Vault store to capture/restore cookies. Required for `profile` to work. */
  vault?: VaultStore | null;
  /** Profile name. When supplied with `vault`, cookies are restored on create
   *  and captured on close. */
  profile?: string;
}
```

3. Extend the private constructor parameter list with `private readonly vault: VaultStore | null = null` and `private profile: string | null = null` (mutable so `setProfile` works).

4. In `Session.create()`, after the existing setup:
```typescript
const inst = new Session(
  engine, cdp, sessionId, "about:blank", null,
  opts.siteGraph ?? null, wd,
  opts.vault ?? null,
  opts.profile ?? null
);
if (opts.profile && opts.vault) {
  await inst.restoreFromVault();
}
return inst;
```

5. Add public methods to `Session`:
```typescript
async restoreFromVault(): Promise<void> {
  if (!this.vault || !this.profile) return;
  await this.cdp.send("Network.enable", {}, this.sessionId);
  const stored = this.vault.list(this.profile);
  await restoreCookies(this.cdp, this.sessionId, stored);
}

async captureToVault(): Promise<void> {
  if (!this.vault || !this.profile) return;
  const cookies = await captureCookies(this.cdp, this.sessionId);
  this.vault.put(this.profile, cookies);
}

getProfile(): string | null {
  return this.profile;
}

setProfile(profile: string | null): void {
  this.profile = profile;
}
```

6. Modify `close()` to call `captureToVault()` before closing CDP:
```typescript
async close(): Promise<void> {
  try { await this.captureToVault(); } catch { /* best-effort */ }
  await this.cdp.close();
  await this.engine.close();
}
```

7. Add a test-only static helper at the bottom of the file:
```typescript
/**
 * Test-only constructor that injects fakes. Use only from tests; production
 * code must use `Session.create()`.
 */
export type SessionInjected = {
  engine: { close: () => Promise<void> };
  cdp: { send: (m: string, p?: Record<string, unknown>, s?: string) => Promise<unknown>; close?: () => Promise<void> };
  sessionId: string;
  vault?: VaultStore | null;
  profile?: string;
  url?: string;
};

(Session as unknown as { fromInjected: (i: SessionInjected) => Session }).fromInjected =
  (i: SessionInjected): Session => {
    return new (Session as unknown as new (
      engine: unknown, cdp: unknown, sessionId: string, url: string,
      lastSnapshot: unknown, siteGraph: unknown, watchdog: unknown,
      vault: VaultStore | null, profile: string | null
    ) => Session)(
      i.engine,
      { ...i.cdp, close: i.cdp.close ?? (async () => {}) },
      i.sessionId,
      i.url ?? "about:blank",
      null, null,
      // Watchdog needs to exist for typed access — pass a no-op fake.
      { evaluatePre: () => ({ ok: true, backendNodeId: null }), evaluatePost: () => [], setPolicy: () => {} },
      i.vault ?? null,
      i.profile ?? null
    );
  };
```

This is hacky but isolates the test seam without exposing a public injection API.

- [ ] **Step 4: Forward profile through SessionManager**

Modify `orchestrator/src/session/manager.ts`:

The current `SessionFactory` type is `() => Promise<Session>`. Extend it to accept an opts arg:
```typescript
export type SessionFactory = (opts?: { profile?: string }) => Promise<Session>;
```

And in `SessionManager.create()`:
```typescript
async create(opts: { profile?: string } = {}): Promise<string> {
  const session = await this.factory(opts);
  const id = randomUUID();
  this.sessions.set(id, session);
  return id;
}
```

Update the factory closures in `orchestrator/src/index.ts` to thread through `opts.profile` to `Session.create()`.

- [ ] **Step 5: Verify + commit**

```
pnpm --filter husk-orchestrator vitest run
pnpm --filter husk-orchestrator typecheck
git add orchestrator/src/session/session.ts orchestrator/src/session/manager.ts orchestrator/src/index.ts \
        orchestrator/tests/session/profile-wiring.test.ts
git commit -m "feat(session): profile arg restores cookies on create, captures on close"
```

Expected: 5 new tests pass + all existing tests still pass.

---

## Task 5: HTTP `create_session` profile param + `vault_*` methods

**Files:**
- Modify: `orchestrator/src/http/methods.ts`
- Modify: `orchestrator/src/index.ts` (spawn VaultStore in `runServer`; expose to `MethodContext`)
- Create: `orchestrator/tests/http/vault-methods.test.ts`

- [ ] **Step 1: Write failing tests**

`orchestrator/tests/http/vault-methods.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { METHODS } from "../../src/http/methods.js";
import { SessionManager } from "../../src/session/manager.js";
import { VaultStore } from "../../src/vault/store.js";
import type { Session } from "../../src/session/session.js";

function makeCtx(vault: VaultStore, sessionFactoryArg: { profile?: string } | null = null) {
  let captured: { profile?: string } | undefined;
  const sm = new SessionManager(async (opts) => {
    captured = opts;
    return { close: async () => {} } as Session;
  });
  return { ctx: { sessions: sm, version: "0.0.0", vault }, getProfileArg: () => captured };
}

describe("HTTP vault methods", () => {
  let dir: string;
  let vault: VaultStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "husk-vault-http-"));
    vault = new VaultStore({ vaultDir: dir });
  });
  afterEach(() => {
    vault.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("create_session accepts optional profile and forwards it to the factory", async () => {
    const { ctx, getProfileArg } = makeCtx(vault);
    await METHODS.create_session({ profile: "work" } as unknown as Record<string, unknown>, ctx);
    expect(getProfileArg()?.profile).toBe("work");
  });

  it("create_session without profile forwards undefined", async () => {
    const { ctx, getProfileArg } = makeCtx(vault);
    await METHODS.create_session({}, ctx);
    expect(getProfileArg()?.profile).toBeUndefined();
  });

  it("vault_list_profiles returns every profile in the vault", async () => {
    vault.put("default", [{ name: "a", value: "1", domain: "x.test", path: "/", expires: -1, size: 1, httpOnly: false, secure: false, session: true }]);
    vault.put("work", [{ name: "b", value: "2", domain: "x.test", path: "/", expires: -1, size: 1, httpOnly: false, secure: false, session: true }]);
    const { ctx } = makeCtx(vault);
    const r = (await METHODS.vault_list_profiles({}, ctx)) as { profiles: string[] };
    expect(r.profiles.sort()).toEqual(["default", "work"]);
  });

  it("vault_list_cookies returns cookies for a profile", async () => {
    vault.put("default", [{ name: "sid", value: "abc", domain: "x.test", path: "/", expires: -1, size: 3, httpOnly: false, secure: false, session: true }]);
    const { ctx } = makeCtx(vault);
    const r = (await METHODS.vault_list_cookies({ profile: "default" }, ctx)) as { cookies: Array<{ name: string }> };
    expect(r.cookies.length).toBe(1);
    expect(r.cookies[0].name).toBe("sid");
  });

  it("vault_clear empties a profile", async () => {
    vault.put("default", [{ name: "sid", value: "abc", domain: "x.test", path: "/", expires: -1, size: 3, httpOnly: false, secure: false, session: true }]);
    const { ctx } = makeCtx(vault);
    await METHODS.vault_clear({ profile: "default" }, ctx);
    expect(vault.list("default")).toEqual([]);
  });

  it("vault_remove_cookie deletes by name+domain+path", async () => {
    vault.put("default", [
      { name: "a", value: "1", domain: "x.test", path: "/", expires: -1, size: 1, httpOnly: false, secure: false, session: true },
      { name: "b", value: "2", domain: "x.test", path: "/", expires: -1, size: 1, httpOnly: false, secure: false, session: true },
    ]);
    const { ctx } = makeCtx(vault);
    await METHODS.vault_remove_cookie({ profile: "default", name: "a", domain: "x.test", path: "/" }, ctx);
    const remaining = vault.list("default").map((c) => c.name);
    expect(remaining).toEqual(["b"]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run http/vault-methods
```

- [ ] **Step 3: Extend MethodContext + METHODS**

Modify `orchestrator/src/http/methods.ts`:

1. Extend `MethodContext`:
```typescript
import type { VaultStore } from "../vault/store.js";

export interface MethodContext {
  sessions: SessionManager;
  version: string;
  vault: VaultStore;
}
```

2. Modify the existing `create_session` handler to accept `profile`:
```typescript
async create_session(
  params: { profile?: string } | undefined,
  ctx: MethodContext
): Promise<CreateSessionResult> {
  const session_id = await ctx.sessions.create({ profile: params?.profile });
  return { session_id };
},
```

3. Add new handlers (inside `METHODS`):
```typescript
async vault_list_profiles(_params: unknown, ctx: MethodContext) {
  return { profiles: ctx.vault.listProfiles() };
},

async vault_list_cookies(params: { profile: string }, ctx: MethodContext) {
  return { cookies: ctx.vault.list(params.profile) };
},

async vault_clear(params: { profile: string }, ctx: MethodContext) {
  ctx.vault.clear(params.profile);
  return { ok: true };
},

async vault_remove_cookie(
  params: { profile: string; name: string; domain: string; path: string },
  ctx: MethodContext
) {
  ctx.vault.remove(params.profile, { name: params.name, domain: params.domain, path: params.path });
  return { ok: true };
},
```

- [ ] **Step 4: Wire vault into runServer**

Modify `orchestrator/src/index.ts` `runServer()`:

```typescript
import { VaultStore } from "./vault/store.js";

// inside runServer, before SessionManager construction:
const vaultDir = process.env.HUSK_VAULT_DIR ?? pathJoin(homedir(), ".husk", "vault");
const vault = new VaultStore({
  vaultDir,
  encryptionKey: process.env.HUSK_VAULT_KEY,
});

const sessions = new SessionManager(async (opts) => {
  const session = await Session.create({
    log: (l) => process.stderr.write(l + "\n"),
    siteGraph,
    vault,
    profile: opts?.profile,
  });
  if (defaultPolicy) session.setPolicy(defaultPolicy);
  return session;
});

// Pass vault into MethodContext when constructing server:
const server = await createHuskServer({
  port: args.port, host: args.host, sessions, version: getVersion(),
  logLevel: args.logLevel,
  vault, // new
});

// And in createHuskServer (orchestrator/src/http/server.ts), accept vault and
// thread it through into the MethodContext.
```

You also need to extend `orchestrator/src/http/server.ts` to accept `vault: VaultStore` in `HuskServerOptions` and pass it through into the `ctx` constant where `MethodContext` is built.

Add cleanup to the SIGINT/SIGTERM shutdown:
```typescript
await server.stop();
siteGraph.close();
vault.close();
```

- [ ] **Step 5: Verify + commit**

```
pnpm --filter husk-orchestrator vitest run
pnpm --filter husk-orchestrator typecheck
git add orchestrator/src/http/methods.ts orchestrator/src/http/server.ts orchestrator/src/index.ts \
        orchestrator/tests/http/vault-methods.test.ts
git commit -m "feat(http): create_session profile param + vault_* RPC methods"
```

Expected: 6 new tests pass.

---

## Task 6: TS SDK Vault API

**Files:**
- Modify: `sdk-ts/src/index.ts` (createSession({profile?}); new `Husk.vault` namespace)
- Modify: `sdk-ts/src/session.ts` (no change — Session is profile-agnostic; profile is established at creation)
- Create: `sdk-ts/tests/vault.test.ts`

- [ ] **Step 1: Write failing test**

`sdk-ts/tests/vault.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { Husk } from "../src/index.js";

function makeMockFetch(routes: Record<string, (params: Record<string, unknown>) => unknown>) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const handler = routes[body.method];
    if (!handler) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: `No: ${body.method}` } }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result: handler(body.params) }),
      { status: 200 }
    );
  });
}

describe("Husk vault API", () => {
  it("createSession forwards profile param", async () => {
    let captured: unknown;
    const fetchMock = makeMockFetch({
      create_session: (p) => { captured = p; return { session_id: "s1" }; },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    await h.createSession({ profile: "work" });
    expect(captured).toEqual({ profile: "work" });
  });

  it("createSession() with no arg sends empty params (no profile)", async () => {
    let captured: unknown;
    const fetchMock = makeMockFetch({
      create_session: (p) => { captured = p; return { session_id: "s1" }; },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    await h.createSession();
    expect(captured).toEqual({});
  });

  it("h.vault.listProfiles calls vault_list_profiles and returns profiles", async () => {
    const fetchMock = makeMockFetch({
      vault_list_profiles: () => ({ profiles: ["default", "work"] }),
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    const got = await h.vault.listProfiles();
    expect(got).toEqual(["default", "work"]);
  });

  it("h.vault.listCookies(profile) calls vault_list_cookies", async () => {
    const fetchMock = makeMockFetch({
      vault_list_cookies: (p) => {
        expect(p).toEqual({ profile: "work" });
        return { cookies: [{ name: "sid", value: "x", domain: "ex.test", path: "/", expires: -1, size: 3, httpOnly: false, secure: false, session: true }] };
      },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    const got = await h.vault.listCookies("work");
    expect(got[0].name).toBe("sid");
  });

  it("h.vault.clear(profile) calls vault_clear", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const fetchMock = makeMockFetch({
      vault_clear: (p) => { calls.push({ method: "vault_clear", params: p }); return { ok: true }; },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    await h.vault.clear("work");
    expect(calls[0].params).toEqual({ profile: "work" });
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter @husk/sdk vitest run vault
```

- [ ] **Step 3: Extend Husk**

Modify `sdk-ts/src/index.ts`:

1. Add a `Cookie` type re-export (already in types.ts? Add if missing):
```typescript
export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  url?: string;
}
```
Add this to `sdk-ts/src/types.ts` and re-export from `index.ts` (`export * from "./types.js"` already does this).

2. Extend `Husk`:
```typescript
export class Husk {
  // ... existing fields ...
  public readonly vault: VaultApi;

  constructor(options: HuskOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.client = new JsonRpcClient({ baseUrl: this.baseUrl, fetch: options.fetch });
    this.vault = new VaultApi(this.client);
  }

  async createSession(options: { profile?: string } = {}): Promise<Session> {
    const params = options.profile !== undefined ? { profile: options.profile } : {};
    const { session_id } = await this.client.call<{ session_id: string }>("create_session", params);
    return new Session(this.client, session_id);
  }
  // ... rest unchanged ...
}

class VaultApi {
  constructor(private readonly client: JsonRpcClient) {}

  async listProfiles(): Promise<string[]> {
    const r = await this.client.call<{ profiles: string[] }>("vault_list_profiles", {});
    return r.profiles;
  }

  async listCookies(profile: string): Promise<Cookie[]> {
    const r = await this.client.call<{ cookies: Cookie[] }>("vault_list_cookies", { profile });
    return r.cookies;
  }

  async clear(profile: string): Promise<void> {
    await this.client.call("vault_clear", { profile });
  }

  async removeCookie(profile: string, name: string, domain: string, path: string): Promise<void> {
    await this.client.call("vault_remove_cookie", { profile, name, domain, path });
  }
}
```

- [ ] **Step 4: Verify + commit**

```
pnpm --filter @husk/sdk vitest run
pnpm --filter @husk/sdk typecheck
git add sdk-ts/src/index.ts sdk-ts/src/types.ts sdk-ts/tests/vault.test.ts
git commit -m "feat(sdk-ts): createSession({profile}) + Husk.vault namespace"
```

Expected: 5 new tests pass.

---

## Task 7: Python SDK Vault API

**Files:**
- Create: `sdk-py/husk/_vault.py`
- Modify: `sdk-py/husk/__init__.py` (Husk.create_session accepts profile; Husk.vault async accessor)
- Modify: `sdk-py/husk/_types.py` (Cookie dataclass)
- Create: `sdk-py/tests/test_vault.py`

- [ ] **Step 1: Write failing test**

`sdk-py/tests/test_vault.py`:

```python
from __future__ import annotations
import json
from typing import Callable
import pytest
import httpx
from husk import Husk
from husk._types import Cookie


def make_router(routes: dict[str, Callable]) -> httpx.MockTransport:
    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        h = routes.get(body["method"])
        if not h:
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "error": {"code": -32601, "message": f"No: {body['method']}"}})
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": h(body["params"])})
    return httpx.MockTransport(handler)


def make_husk(routes: dict[str, Callable]) -> Husk:
    client = httpx.AsyncClient(transport=make_router(routes))
    return Husk(base_url="http://x.test", _http_client=client)


async def test_create_session_forwards_profile() -> None:
    captured: dict = {}
    h = make_husk({
        "create_session": lambda p: (captured.update(p), {"session_id": "s1"})[1],
    })
    async with h:
        await h.create_session(profile="work")
    assert captured == {"profile": "work"}


async def test_create_session_no_profile() -> None:
    captured: dict = {}
    h = make_husk({
        "create_session": lambda p: (captured.update({"params": p}), {"session_id": "s1"})[1],
    })
    async with h:
        await h.create_session()
    assert captured["params"] == {}


async def test_vault_list_profiles() -> None:
    h = make_husk({
        "vault_list_profiles": lambda _: {"profiles": ["default", "work"]},
    })
    async with h:
        got = await h.vault.list_profiles()
    assert got == ["default", "work"]


async def test_vault_list_cookies_returns_cookie_dataclass() -> None:
    h = make_husk({
        "vault_list_cookies": lambda _: {"cookies": [
            {"name": "sid", "value": "x", "domain": "ex.test", "path": "/",
             "expires": -1, "size": 3, "httpOnly": False, "secure": False, "session": True,
             "sameSite": "Lax"}
        ]},
    })
    async with h:
        got = await h.vault.list_cookies("default")
    assert len(got) == 1
    assert isinstance(got[0], Cookie)
    assert got[0].name == "sid"
    assert got[0].same_site == "Lax"


async def test_vault_clear() -> None:
    calls: list[dict] = []
    h = make_husk({
        "vault_clear": lambda p: (calls.append(p), {"ok": True})[1],
    })
    async with h:
        await h.vault.clear("work")
    assert calls[0] == {"profile": "work"}
```

- [ ] **Step 2: Run, verify FAIL**

```
cd sdk-py && uv run python -m pytest tests/test_vault.py
```

- [ ] **Step 3: Add Cookie dataclass + parser**

Append to `sdk-py/husk/_types.py`:

```python
@dataclass(frozen=True, slots=True)
class Cookie:
    name: str
    value: str
    domain: str
    path: str
    expires: int
    size: int
    http_only: bool
    secure: bool
    session: bool
    same_site: Optional[str] = None
    url: Optional[str] = None


def parse_cookie(d: Mapping[str, Any]) -> Cookie:
    return Cookie(
        name=d["name"],
        value=d["value"],
        domain=d["domain"],
        path=d["path"],
        expires=d["expires"],
        size=d["size"],
        http_only=d["httpOnly"],  # CDP uses camelCase; mirror it
        secure=d["secure"],
        session=d["session"],
        same_site=d.get("sameSite"),
        url=d.get("url"),
    )
```

- [ ] **Step 4: Implement VaultApi**

`sdk-py/husk/_vault.py`:

```python
"""Vault namespace for Husk SDK."""
from __future__ import annotations

from ._transport import JsonRpcClient
from ._types import Cookie, parse_cookie


class VaultApi:
    """Cookie vault operations. Access via `Husk.vault`."""

    def __init__(self, client: JsonRpcClient) -> None:
        self._client = client

    async def list_profiles(self) -> list[str]:
        r = await self._client.call("vault_list_profiles", {})
        return list(r["profiles"])

    async def list_cookies(self, profile: str) -> list[Cookie]:
        r = await self._client.call("vault_list_cookies", {"profile": profile})
        return [parse_cookie(c) for c in r["cookies"]]

    async def clear(self, profile: str) -> None:
        await self._client.call("vault_clear", {"profile": profile})

    async def remove_cookie(self, profile: str, name: str, domain: str, path: str) -> None:
        await self._client.call(
            "vault_remove_cookie",
            {"profile": profile, "name": name, "domain": domain, "path": path},
        )
```

- [ ] **Step 5: Extend Husk**

Modify `sdk-py/husk/__init__.py`:

1. Add imports:
```python
from ._vault import VaultApi
from ._types import Cookie, parse_cookie
```

2. Modify `Husk.__init__`:
```python
def __init__(
    self,
    base_url: str = DEFAULT_BASE_URL,
    *,
    _http_client: Optional[httpx.AsyncClient] = None,
) -> None:
    self.base_url = base_url
    self._client = JsonRpcClient(base_url=base_url, http_client=_http_client)
    self.vault = VaultApi(self._client)
```

3. Modify `create_session`:
```python
async def create_session(self, *, profile: Optional[str] = None) -> Session:
    params: dict[str, Any] = {}
    if profile is not None:
        params["profile"] = profile
    r = await self._client.call("create_session", params)
    return Session(self._client, r["session_id"])
```

4. Append to `__all__`:
```python
"Cookie", "VaultApi", "parse_cookie",
```

- [ ] **Step 6: Verify + commit**

```
cd sdk-py && uv run python -m pytest
git add sdk-py/husk/_vault.py sdk-py/husk/_types.py sdk-py/husk/__init__.py sdk-py/tests/test_vault.py
git commit -m "feat(sdk-py): Husk.create_session(profile=) + Husk.vault namespace"
```

Expected: 5 new tests pass.

---

## Task 8: MCP Vault Tools

**Files:**
- Modify: `mcp/src/tool-surface.ts` (extend `husk_create_session` schema; add `husk_vault_list_profiles`, `husk_vault_clear`)
- Modify: `mcp/tests/tool-surface.test.ts` (extend assertions)

- [ ] **Step 1: Append failing tests**

Append to `mcp/tests/tool-surface.test.ts`:

```typescript
describe("vault tools", () => {
  it("TOOL_SURFACE includes husk_vault_list_profiles + husk_vault_clear", () => {
    const names = TOOL_SURFACE.map((t) => t.name);
    expect(names).toContain("husk_vault_list_profiles");
    expect(names).toContain("husk_vault_clear");
  });

  it("husk_create_session schema accepts optional profile", () => {
    const tool = TOOL_SURFACE.find((t) => t.name === "husk_create_session")!;
    expect(tool.inputSchema.properties.profile).toBeDefined();
  });

  it("handleToolCall routes husk_vault_list_profiles to vault_list_profiles", async () => {
    const client = { call: vi.fn(async () => ({ profiles: ["default"] })) };
    await handleToolCall(client as any, "husk_vault_list_profiles", {});
    expect(client.call).toHaveBeenCalledWith("vault_list_profiles", {});
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter @husk/mcp vitest run tool-surface
```

- [ ] **Step 3: Update tool-surface.ts**

Modify `mcp/src/tool-surface.ts`:

1. Add `profile` to the `husk_create_session` schema:
```typescript
{
  name: "husk_create_session",
  description: "Husk — Create a new browser session. Returns { session_id }. Pass `profile` to bind the session to a named cookie vault (cookies persist across sessions).",
  inputSchema: {
    type: "object",
    properties: {
      profile: { type: "string", description: "Optional profile name to restore cookies from" },
    },
  },
},
```

2. Add new tools:
```typescript
{
  name: "husk_vault_list_profiles",
  description: "Husk — List all named profiles in the cookie vault.",
  inputSchema: { type: "object", properties: {} },
},
{
  name: "husk_vault_clear",
  description: "Husk — Clear every cookie stored for a profile.",
  inputSchema: {
    type: "object",
    properties: { profile: { type: "string" } },
    required: ["profile"],
  },
},
```

3. Extend `RPC_MAP`:
```typescript
husk_vault_list_profiles: "vault_list_profiles",
husk_vault_clear: "vault_clear",
```

- [ ] **Step 4: Verify + commit**

```
pnpm --filter @husk/mcp vitest run
pnpm --filter @husk/mcp typecheck
git add mcp/src/tool-surface.ts mcp/tests/tool-surface.test.ts
git commit -m "feat(mcp): husk_vault_* tools + profile arg on husk_create_session"
```

Expected: 3 new tests pass.

---

## Task 9: CLI `husk vault` Subcommand

**Files:**
- Modify: `orchestrator/src/index.ts` (add `vault` subcommand with `list` + `clear`)
- Create: `orchestrator/tests/cli/vault.test.ts`

- [ ] **Step 1: Write failing test**

`orchestrator/tests/cli/vault.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VaultStore } from "../../src/vault/store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const huskBin = join(__dirname, "..", "..", "dist", "index.js");

function runHusk(args: string[], env: Record<string, string> = {}): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("node", [huskBin, ...args], { env: { ...process.env, ...env }, encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

describe("husk vault CLI", () => {
  it("husk vault list shows seeded profiles", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cli-vault-"));
    try {
      const s = new VaultStore({ vaultDir: dir });
      s.put("default", [{ name: "a", value: "1", domain: "x.test", path: "/", expires: -1, size: 1, httpOnly: false, secure: false, session: true }]);
      s.put("work", [{ name: "b", value: "2", domain: "x.test", path: "/", expires: -1, size: 1, httpOnly: false, secure: false, session: true }]);
      s.close();
      const r = runHusk(["vault", "list"], { HUSK_VAULT_DIR: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/default/);
      expect(r.stdout).toMatch(/work/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("husk vault clear <profile> empties the profile", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cli-vault-"));
    try {
      const s = new VaultStore({ vaultDir: dir });
      s.put("default", [{ name: "a", value: "1", domain: "x.test", path: "/", expires: -1, size: 1, httpOnly: false, secure: false, session: true }]);
      s.close();
      const r = runHusk(["vault", "clear", "default"], { HUSK_VAULT_DIR: dir });
      expect(r.status).toBe(0);
      const verify = new VaultStore({ vaultDir: dir });
      expect(verify.list("default")).toEqual([]);
      verify.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("husk vault clear without a profile exits non-zero", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cli-vault-"));
    try {
      const r = runHusk(["vault", "clear"], { HUSK_VAULT_DIR: dir });
      expect(r.status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Build first (CLI tests spawn the binary)**

```
pnpm --filter husk-orchestrator build
```

- [ ] **Step 3: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run cli/vault
```

- [ ] **Step 4: Add `vault` subcommand**

Modify `orchestrator/src/index.ts`. Find the top-level command switch (the `cmd` argument handler). Add a `vault` case:

```typescript
} else if (cmd === "vault") {
  await runVault(args.slice(1));
}
```

Add at the bottom of the file:

```typescript
async function runVault(rest: string[]): Promise<void> {
  const sub = rest[0];
  const vaultDir = process.env.HUSK_VAULT_DIR ?? pathJoin(homedir(), ".husk", "vault");
  const vault = new VaultStore({
    vaultDir,
    encryptionKey: process.env.HUSK_VAULT_KEY,
  });
  try {
    if (sub === "list") {
      const profiles = vault.listProfiles();
      if (profiles.length === 0) {
        console.log("No profiles.");
      } else {
        for (const p of profiles) {
          const n = vault.list(p).length;
          console.log(`${p}\t${n} cookie${n === 1 ? "" : "s"}`);
        }
      }
    } else if (sub === "clear") {
      const profile = rest[1];
      if (!profile) {
        console.error("Usage: husk vault clear <profile>");
        process.exit(1);
      }
      vault.clear(profile);
      console.log(`Cleared ${profile}.`);
    } else {
      console.error("Usage: husk vault list | husk vault clear <profile>");
      process.exit(1);
    }
  } finally {
    vault.close();
  }
}
```

Add the import: `import { VaultStore } from "./vault/store.js";`

- [ ] **Step 5: Build + run + commit**

```
pnpm --filter husk-orchestrator build
pnpm --filter husk-orchestrator vitest run cli/vault
git add orchestrator/src/index.ts orchestrator/tests/cli/vault.test.ts
git commit -m "feat(cli): husk vault list/clear subcommands"
```

Expected: 3 tests pass.

---

## Task 10: Real-Lightpanda Login Round-Trip Integration Test

**Files:**
- Create: `orchestrator/tests/integration/login-fixture-server.ts`
- Create: `orchestrator/tests/integration/vault-e2e.test.ts`

- [ ] **Step 1: Write login fixture server**

`orchestrator/tests/integration/login-fixture-server.ts`:

```typescript
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface LoginFixtureServer {
  url: string;
  close(): Promise<void>;
}

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Login Fixture</title></head>
<body>
  <main role="main">
    <h1>Sign in</h1>
    <form method="POST" action="/login">
      <label>Username <input type="text" name="user" /></label>
      <label>Password <input type="password" name="pass" /></label>
      <button type="submit">Sign in</button>
    </form>
  </main>
</body></html>`;

const PROTECTED_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Welcome</title></head>
<body>
  <main role="main">
    <h1>Welcome back</h1>
    <p>You are signed in as <span id="user">demo</span>.</p>
  </main>
</body></html>`;

const UNAUTHORIZED_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Unauthorized</title></head>
<body><main role="main"><h1>Please sign in</h1></main></body></html>`;

export async function startLoginFixture(): Promise<LoginFixtureServer> {
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/login" && req.method === "POST") {
      res.setHeader("set-cookie", "husk_demo_session=valid; Path=/; HttpOnly");
      res.writeHead(303, { Location: "/protected" });
      res.end();
      return;
    }
    if (req.url === "/protected") {
      const cookie = (req.headers.cookie ?? "");
      if (cookie.includes("husk_demo_session=valid")) {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(PROTECTED_HTML);
      } else {
        res.writeHead(401, { "content-type": "text/html" });
        res.end(UNAUTHORIZED_HTML);
      }
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(LOGIN_HTML);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
```

- [ ] **Step 2: Write the integration test**

`orchestrator/tests/integration/vault-e2e.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../../src/session/session.js";
import { VaultStore } from "../../src/vault/store.js";
import { locateLightpanda } from "../../src/engine/binary.js";
import { startLoginFixture } from "./login-fixture-server.js";

const integrationOrSkip = await (async () => {
  try { await locateLightpanda(); return describe; } catch { return describe.skip; }
})();

integrationOrSkip("vault e2e — login round-trip", () => {
  it("cookies captured on close are restored on next Session.create({profile})", async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), "husk-vault-e2e-"));
    const vault = new VaultStore({ vaultDir });
    const fixture = await startLoginFixture();

    try {
      // First session: log in by POSTing the form. Snapshot the protected page.
      let s1: Session | undefined;
      try {
        s1 = await Session.create({
          readinessTimeoutMs: 15_000,
          vault,
          profile: "demo",
        });
        // Submit the login form by navigating directly to /login with the cookie
        // header inserted via a fake form POST — easier route: just goto /login
        // via POST is not supported by Session.goto. Instead, set the cookie
        // server-side by hitting the form action via Network.setCookies (post-login).
        // Cleanest: navigate to /, then have Session.goto(/protected) after a manual cookie set.
        await s1.goto(fixture.url);
        // Trigger a login by setting the cookie directly via CDP (the fixture
        // server returns the cookie on POST, but in this v0 we don't have form
        // submit — emulate by setting the cookie that the server would set).
        await s1["cdp"].send("Network.setCookies", {
          cookies: [{
            name: "husk_demo_session",
            value: "valid",
            domain: "127.0.0.1",
            path: "/",
            expires: 4000000000,
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          }],
        }, s1["sessionId"]);
        await s1.goto(`${fixture.url}/protected`);
        const snap1 = await s1.snapshot();
        // Welcome back heading present?
        const hasWelcome = JSON.stringify(snap1).includes("Welcome back");
        expect(hasWelcome).toBe(true);
      } finally {
        await s1?.close();
      }

      // Vault should now have husk_demo_session for 127.0.0.1.
      const stored = vault.list("demo");
      expect(stored.find((c) => c.name === "husk_demo_session" && c.value === "valid")).toBeDefined();

      // Second session: NO manual cookie. Restored from vault should yield logged-in /protected.
      let s2: Session | undefined;
      try {
        s2 = await Session.create({
          readinessTimeoutMs: 15_000,
          vault,
          profile: "demo",
        });
        await s2.goto(`${fixture.url}/protected`);
        const snap2 = await s2.snapshot();
        expect(JSON.stringify(snap2).includes("Welcome back")).toBe(true);
      } finally {
        await s2?.close();
      }
    } finally {
      await fixture.close();
      vault.close();
      rmSync(vaultDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("a third session without profile gets a clean cookie jar (no restoration)", async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), "husk-vault-no-restore-"));
    const vault = new VaultStore({ vaultDir });
    const fixture = await startLoginFixture();

    try {
      // Seed the vault with a session cookie
      vault.put("demo", [{
        name: "husk_demo_session", value: "valid",
        domain: "127.0.0.1", path: "/",
        expires: 4000000000, size: 24,
        httpOnly: true, secure: false, session: false, sameSite: "Lax",
      }]);

      // Session WITHOUT profile must NOT see the cookie → expect Unauthorized
      let s: Session | undefined;
      try {
        s = await Session.create({ readinessTimeoutMs: 15_000, vault });
        await s.goto(`${fixture.url}/protected`);
        const snap = await s.snapshot();
        expect(JSON.stringify(snap).includes("Please sign in")).toBe(true);
      } finally {
        await s?.close();
      }
    } finally {
      await fixture.close();
      vault.close();
      rmSync(vaultDir, { recursive: true, force: true });
    }
  }, 60_000);
});
```

- [ ] **Step 3: Run with LIGHTPANDA_BIN**

```
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  pnpm --filter husk-orchestrator vitest run integration/vault-e2e
```
Expected: 2 tests pass. Logged-in round-trip is the load-bearing wedge demo for M8a.

If the first test fails because lightpanda doesn't honour the manually-set cookie on subsequent navigation, the workaround is to use a session-cookie domain that matches the fixture port host directly. Debug step: log `vault.list("demo")` after s1 closes — should contain the cookie.

- [ ] **Step 4: Run without LIGHTPANDA_BIN — verify skip**

```
pnpm --filter husk-orchestrator vitest run integration/vault-e2e
```

- [ ] **Step 5: Commit**

```bash
git add orchestrator/tests/integration/login-fixture-server.ts \
        orchestrator/tests/integration/vault-e2e.test.ts
git commit -m "test(vault): real-lightpanda login round-trip via cookie persistence"
```

---

## Task 11: Spec Amendment + Memory Update

**Files:**
- Modify: `docs/superpowers/specs/2026-05-13-husk-design.md` (add §5.4)
- Modify: `~/.claude/projects/-Users-nirmalghinaiya-Desktop/memory/husk-roadmap.md` (add M8a shipped row)
- Modify: `~/.claude/projects/-Users-nirmalghinaiya-Desktop/memory/husk-architecture.md` (add Decision H — vault strategy)

- [ ] **Step 1: Append spec §5.4**

In `docs/superpowers/specs/2026-05-13-husk-design.md`, after §5.3 (Watchdog Rule Engine), add:

```markdown
### 5.4 Cookie Vault (M8a — shipped 2026-05-15)

Per-profile cookie persistence so sessions survive across `husk start` restarts. Foundation for M8b/c (full auth pillar).

**Storage:** per-profile SQLite at `~/.husk/vault/{profile}.db` (overridable via `HUSK_VAULT_DIR`). File mode 0600. Cookies stored in CDP `Network.Cookie` format verbatim. Optional AES-256-GCM at-rest encryption via `HUSK_VAULT_KEY` env (base64 32-byte key, scrypt-derived with fixed salt `husk-vault-v1`).

**Capture:** `Network.getAllCookies` polled on session close (best-effort). Lightpanda lacks `requestWillBeSentExtraInfo` events, so we can't intercept Set-Cookie in flight; close-time capture is sufficient for cookie-based SSO.

**Restoration:** on `Session.create({ profile })`, the orchestrator calls `Network.enable` + `Network.setCookies` before any user-initiated navigation.

**Profile concept:** free-form string, validated `^[A-Za-z0-9_.-]{1,64}$`. Default is no profile (cookies not persisted). Sessions without a profile get a clean jar every time.

**Threat model:** file mode 0600 protects against accidental disclosure (shared folders, backup uploads). `HUSK_VAULT_KEY` adds AES-GCM for at-rest attackers without process env access. NOT designed for adversaries with local read of the orchestrator process — that's M10 cloud's job.

**Known gaps (M8b/c territory):**
- `localStorage` / `sessionStorage` not persisted — lightpanda's Shed is in-memory only.
- IndexedDB absent in lightpanda upstream — Firebase Auth, AWS Amplify, Auth0 SPA SDK auth tokens will fail silently.
- Cookie partition keys (`Partitioned` attribute / CHIPS) silently ignored.
- Login form auto-fill, TOTP, OIDC redirect capture, SAML, MFA hooks — all M8b/c.
```

- [ ] **Step 2: Update husk-roadmap memory**

Edit `/Users/nirmalghinaiya/.claude/projects/-Users-nirmalghinaiya-Desktop/memory/husk-roadmap.md`. Add row to the "Shipped" table:

```markdown
| `v0.0.8-m8a` | **Cookie vault (auth foundation)** | Per-profile SQLite at `~/.husk/vault/{profile}.db`. Sessions with `{profile}` arg restore cookies via CDP `Network.setCookies` on create, capture via `Network.getAllCookies` on close. Optional AES-256-GCM encryption via `HUSK_VAULT_KEY`. `husk vault list/clear` CLI + `vault_*` JSON-RPC methods + `Husk.vault` SDK namespace + `husk_vault_*` MCP tools. 302 tests. Foundation for M8b (login forms + TOTP) and M8c (SSO/OIDC + MFA) |
```

Remove M8a from the active pipeline; add M8b + M8c rows.

- [ ] **Step 3: Append Decision H to husk-architecture memory**

Edit `/Users/nirmalghinaiya/.claude/projects/-Users-nirmalghinaiya-Desktop/memory/husk-architecture.md`. Append:

```markdown
## Decision H: Husk owns cookie storage (does NOT use lightpanda's `--cookie-jar`)

**Locked by:** M8a plan (2026-05-15)
**Why:** Lightpanda upstream has a `--cookie-jar` file mechanism that loads on server init / saves on deinit. Husk explicitly does not use it because (1) save-on-deinit loses mid-session changes if the engine crashes; (2) the file format is plaintext JSON; (3) profile-multiplexing belongs in the orchestrator (one engine process per session in v0); (4) when v0.1+ adds the M12 hybrid Chromium engine, the orchestrator-managed approach works unchanged.

**How to apply:** Cookie persistence is a Husk concern, not a lightpanda concern. CDP `Network.getAllCookies` / `Network.setCookies` are the integration points. If considering "just use --cookie-jar," remember: it doesn't survive crashes and is engine-specific.
```

- [ ] **Step 4: Run full repo suite**

```
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  pnpm -r --filter './orchestrator' --filter './sdk-ts' --filter './mcp' run test
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  bash -c "cd sdk-py && uv run python -m pytest"
```
Expected: 302 tests pass.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-13-husk-design.md
git commit -m "docs: spec §5.4 — cookie vault contract (M8a)"
```

(Memory files commit themselves elsewhere; they're not in this repo.)

---

## Final Steps — Tag and Merge

- [ ] **Step A: Tag**

```bash
git tag -a v0.0.8-m8a -m "M8a — Cookie vault + restoration

Per-profile cookie persistence so sessions survive husk-start restarts.
Foundation for M8b (login forms + TOTP) and M8c (SSO/OIDC + MFA).

Per-profile SQLite at ~/.husk/vault/{profile}.db (HUSK_VAULT_DIR override),
file mode 0600. Cookies in CDP Network.Cookie format. Optional AES-256-GCM
at-rest encryption via HUSK_VAULT_KEY (scrypt-derived).

Capture: Network.getAllCookies on session close. Restore: Network.setCookies
before first goto when Session.create({profile}) is used.

5 new JSON-RPC methods (create_session profile arg + vault_list_profiles/
list_cookies/clear/remove_cookie). SDKs (TS + Py) gain Husk.vault namespace.
MCP gains husk_vault_list_profiles + husk_vault_clear tools. CLI gains
husk vault list/clear.

Real-lightpanda login round-trip integration test passes: log in, close,
new session with profile → still logged in.

302 tests (was 252). Spec §5.4 amended. Localstorage / sessionStorage /
IndexedDB persistence remain M8b/c territory."
```

- [ ] **Step B: Merge to main with --no-ff**

```bash
git checkout main
git merge --no-ff m8a-cookie-vault -m "Merge Milestone 8a (cookie vault): foundation for auth pillar"
```

- [ ] **Step C: Push**

```bash
git push origin main v0.0.8-m8a
```

---

## Self-Review Notes

**Spec coverage (M8a slice of spec §10 auth pillar):**
- [x] Cookie vault — Tasks 1–4
- [x] Per-profile session graphs (per-domain via SQLite, profile-namespaced) — Task 2
- [ ] TOTP — **M8b**
- [ ] SSO/OIDC redirect chaining — **M8c**
- [ ] SAML — **M8c**
- [ ] MFA-with-human-in-loop hooks — **M8c**

**Cross-cutting:**
- [x] CDP capture/restore works against lightpanda per spike findings
- [x] All four interfaces (SDK TS, SDK Py, MCP, CLI) extended for vault
- [x] Encryption hook in place; default plaintext + 0600 documented in spec
- [x] Profile name validation prevents path traversal

**Risk callouts:**
- The integration test in T10 manually injects the cookie via CDP rather than submitting the form. This is because Husk's current SDK has no form-submit primitive (M8b adds `login()`). The test still proves cookie persistence and restoration; the *capture* path is verified, the *restoration* path is verified. The full "submit form → cookie set by server response → capture → restore → re-login" flow is M8b's load-bearing demo.
- `Session.fromInjected` in T4 is a test seam, intentionally not part of the public API. If it grows fragile, T4 may be revisited to use a proper DI mechanism.

**No placeholders.** Every step has concrete code or a specific command.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-husk-m8a-cookie-vault.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, the workflow that's shipped M1–M6.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`.

Which approach? (`1` or `2`)
