# M8b Login Form Primitives + TOTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Husk can log into a website. A `login()` SDK helper takes stored credentials, finds username/password fields via accessibility heuristics, submits the form, and captures the resulting session cookie into the M8a vault. RFC 6238 TOTP support for 2FA-protected sites.

**Architecture:** Credentials live in a separate per-profile SQLite at `~/.husk/credentials/{profile}.db`, encrypted with the same `HUSK_VAULT_KEY` as the cookie vault. `Session.login()` is a high-level helper that orchestrates four primitives: (1) find form fields in the current snapshot via role+name heuristics, (2) type username + password + optional TOTP, (3) click submit, (4) verify post-login via snapshot diff and URL change. No new dependencies — TOTP is pure Node `crypto`.

**Tech Stack:** TypeScript, `better-sqlite3` (already wired), Node 20+. Same AES-256-GCM pattern as M8a vault.

**Spec reference:** `docs/superpowers/specs/2026-05-13-husk-design.md` §5.4 (cookie vault foundation from M8a). M8b extends the auth pillar with credential storage + login automation.

**M8a dependencies (verified shipped):**
- `VaultStore` pattern at `orchestrator/src/vault/store.ts` (reuse for `CredentialsStore`)
- `Session.click/type/snapshot` primitives from M5
- `Session.captureToVault()` from M8a runs on close, so cookies set during login get persisted automatically
- `Husk.vault` namespace on both SDKs — `Husk.credentials` mirrors it

**Known limitations (documented, deferred):**
- No CAPTCHA bypass — out of scope permanently per spec §10.
- No "remember me" UI handling — checkbox heuristic could be added later.
- No password reset / account creation flow — login only.
- M8c handles: SSO/OIDC redirect chains, SAML POST-binding, MFA-with-human-loop hooks.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `orchestrator/src/credentials/types.ts` | `Credential` (username, password, optional totp_secret) |
| `orchestrator/src/credentials/store.ts` | `CredentialsStore` — per-profile SQLite, AES-GCM (mirrors VaultStore exactly) |
| `orchestrator/src/credentials/index.ts` | Re-exports |
| `orchestrator/src/auth/totp.ts` | RFC 6238 TOTP generator (pure crypto) |
| `orchestrator/src/auth/login-locator.ts` | `locateLoginFields(snapshot)` — finds username/password/submit by role+name regex |
| `orchestrator/src/auth/login-flow.ts` | `performLogin(session, credential, totpCode)` — types fields + clicks submit + verifies |
| `orchestrator/src/auth/index.ts` | Re-exports |
| `orchestrator/tests/credentials/store.test.ts` | Mirror of vault/store tests |
| `orchestrator/tests/auth/totp.test.ts` | RFC 6238 known-vector tests |
| `orchestrator/tests/auth/login-locator.test.ts` | Snapshot fixtures (gmail-style, github-style, vanilla) |
| `orchestrator/tests/auth/login-flow.test.ts` | Mocked session + locator |
| `orchestrator/tests/integration/login-real-e2e.test.ts` | Real lightpanda + login fixture with form validation |

### Modified files

| Path | Change |
|---|---|
| `orchestrator/src/session/session.ts` | Add `login(credential)` async method that runs locator → fill → submit → verify |
| `orchestrator/src/http/methods.ts` | Add `credentials_set`, `credentials_remove`, `credentials_list_profiles`, `login` methods; extend `MethodContext` with `credentials: CredentialsStore` |
| `orchestrator/src/http/server.ts` | Accept `credentials` in `HuskServerOptions`, thread to `MethodContext` |
| `orchestrator/src/index.ts` | Instantiate `CredentialsStore` in `runServer`; add `husk login --profile X` CLI subcommand for interactive setup |
| `sdk-ts/src/index.ts` | `Husk.credentials` namespace + `Session.login(creds?)` |
| `sdk-ts/src/session.ts` | Add `login(credential?)` method |
| `sdk-ts/src/types.ts` | Add `Credential` interface |
| `sdk-py/husk/__init__.py` | `Husk.credentials` async namespace + `Session.login(...)` |
| `sdk-py/husk/_session.py` | Add `login()` async method |
| `sdk-py/husk/_types.py` | Add `Credential` dataclass |
| `mcp/src/tool-surface.ts` | Add `husk_login`, `husk_credentials_set` tools |
| `orchestrator/tests/integration/login-fixture-server.ts` | Extend to validate username/password POST body |
| `docs/superpowers/specs/2026-05-13-husk-design.md` | Append §5.5 (login + TOTP contract) |

---

## Test Counts at Each Stage

| After task | Cumulative |
|---|---|
| T1 (Credential types) | 296 + 3 = 299 |
| T2 (CredentialsStore) | 299 + 10 = 309 |
| T3 (TOTP generator) | 309 + 7 = 316 |
| T4 (login-locator) | 316 + 8 = 324 |
| T5 (login-flow + Session.login) | 324 + 6 = 330 |
| T6 (HTTP credentials_* + login methods) | 330 + 7 = 337 |
| T7 (TS SDK credentials + Session.login) | 337 + 6 = 343 |
| T8 (Py SDK credentials + Session.login) | 343 + 6 = 349 |
| T9 (MCP login + credentials_set tools) | 349 + 3 = 352 |
| T10 (CLI husk login interactive) | 352 + 4 = 356 |
| T11 (real-lightpanda login round-trip) | 356 + 2 = 358 |
| T12 (spec §5.5 + memory) | 358 |

Target: 358 tests at M8b end (was 296 after M8a).

---

## Task 1: Credential Types

**Files:**
- Create: `orchestrator/src/credentials/types.ts`
- Create: `orchestrator/src/credentials/index.ts`
- Create: `orchestrator/tests/credentials/types.test.ts`

- [ ] **Step 1: Write failing test**

`orchestrator/tests/credentials/types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { Credential, CredentialKey } from "../../src/credentials/types.js";
import { isValidCredentialKey } from "../../src/credentials/types.js";

describe("isValidCredentialKey", () => {
  it("accepts host-style identifiers", () => {
    expect(isValidCredentialKey("github.com")).toBe(true);
    expect(isValidCredentialKey("login.aetna.com")).toBe(true);
    expect(isValidCredentialKey("app.work.io")).toBe(true);
  });

  it("rejects path separators and traversal", () => {
    expect(isValidCredentialKey("../etc")).toBe(false);
    expect(isValidCredentialKey("foo/bar")).toBe(false);
    expect(isValidCredentialKey("")).toBe(false);
  });

  it("Credential type has the required fields", () => {
    const c: Credential = {
      key: "github.com",
      username: "demo",
      password: "secret",
    };
    expect(c.totp_secret).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run credentials/types
```

- [ ] **Step 3: Implement**

`orchestrator/src/credentials/types.ts`:

```typescript
/**
 * One stored credential. Keyed by `key` (typically a hostname like
 * "github.com"); a single profile may hold many credentials for different
 * sites.
 */
export interface Credential {
  /** Site key — hostname or arbitrary stable id. */
  key: string;
  username: string;
  password: string;
  /** Base32-encoded TOTP secret (RFC 6238). When set, login() can supply
   *  a 6-digit code into a 2FA prompt. */
  totp_secret?: string;
}

export type CredentialKey = string;

const KEY_RE = /^[A-Za-z0-9_.-]{1,128}$/;

export function isValidCredentialKey(key: string): boolean {
  if (!key) return false;
  if (key === "." || key === "..") return false;
  return KEY_RE.test(key);
}
```

`orchestrator/src/credentials/index.ts`:

```typescript
export type { Credential, CredentialKey } from "./types.js";
export { isValidCredentialKey } from "./types.js";
export { CredentialsStore } from "./store.js";
export type { CredentialsStoreOptions } from "./store.js";
```

(`store.ts` doesn't exist yet — T2 creates it. The barrel will compile only after T2; for T1 you can omit the `CredentialsStore` lines and add them in T2's commit.)

- [ ] **Step 4: Verify + commit**

```
pnpm --filter husk-orchestrator vitest run credentials/types
pnpm --filter husk-orchestrator typecheck
git add orchestrator/src/credentials/types.ts orchestrator/src/credentials/index.ts orchestrator/tests/credentials/types.test.ts
git commit -m "feat(credentials): Credential type + key validation"
```

Expected: 3 tests pass.

---

## Task 2: CredentialsStore — Per-Profile SQLite with AES-GCM

**Files:**
- Create: `orchestrator/src/credentials/store.ts`
- Modify: `orchestrator/src/credentials/index.ts` (uncomment CredentialsStore export)
- Create: `orchestrator/tests/credentials/store.test.ts`

This mirrors `orchestrator/src/vault/store.ts` from M8a closely — same pattern, different schema. Read that file first for the structure.

- [ ] **Step 1: Write failing tests**

`orchestrator/tests/credentials/store.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialsStore } from "../../src/credentials/store.js";

describe("CredentialsStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "husk-creds-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a per-profile .db file with 0600 mode", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    store.set("default", { key: "github.com", username: "demo", password: "x" });
    const file = join(dir, "default.db");
    expect(existsSync(file)).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    store.close();
  });

  it("upserts by key", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    store.set("default", { key: "github.com", username: "v1", password: "p1" });
    store.set("default", { key: "github.com", username: "v2", password: "p2" });
    const got = store.get("default", "github.com");
    expect(got?.username).toBe("v2");
    expect(got?.password).toBe("p2");
    store.close();
  });

  it("get returns null for unknown key", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    expect(store.get("default", "missing")).toBeNull();
    store.close();
  });

  it("get returns null for unknown profile", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    expect(store.get("never-created", "github.com")).toBeNull();
    store.close();
  });

  it("list returns all credentials for a profile (without passwords)", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    store.set("default", { key: "github.com", username: "a", password: "p1" });
    store.set("default", { key: "gmail.com", username: "b", password: "p2" });
    const got = store.list("default");
    expect(got.length).toBe(2);
    expect(got.map((c) => c.key).sort()).toEqual(["github.com", "gmail.com"]);
    // Each entry includes username but NOT password (security: list is for
    // enumeration, never returns sensitive material).
    for (const c of got) {
      expect("password" in c).toBe(false);
      expect("totp_secret" in c).toBe(false);
    }
    store.close();
  });

  it("remove deletes one credential", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    store.set("default", { key: "a", username: "a", password: "1" });
    store.set("default", { key: "b", username: "b", password: "2" });
    store.remove("default", "a");
    const remaining = store.list("default").map((c) => c.key);
    expect(remaining).toEqual(["b"]);
    store.close();
  });

  it("listProfiles enumerates profile DB files", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    store.set("default", { key: "a", username: "a", password: "1" });
    store.set("work", { key: "b", username: "b", password: "2" });
    expect(store.listProfiles().sort()).toEqual(["default", "work"]);
    store.close();
  });

  it("encrypts password + totp_secret at rest when HUSK_VAULT_KEY is set", () => {
    const key = Buffer.alloc(32, 9).toString("base64");
    const s1 = new CredentialsStore({ credentialsDir: dir, encryptionKey: key });
    s1.set("default", { key: "github.com", username: "demo", password: "secret", totp_secret: "ABCD1234" });
    s1.close();

    const s2 = new CredentialsStore({ credentialsDir: dir, encryptionKey: key });
    const got = s2.get("default", "github.com");
    expect(got?.password).toBe("secret");
    expect(got?.totp_secret).toBe("ABCD1234");
    s2.close();
  });

  it("encrypted creds are unreadable with a different key", () => {
    const dir2 = mkdtempSync(join(tmpdir(), "husk-creds2-"));
    try {
      const k1 = Buffer.alloc(32, 1).toString("base64");
      const k2 = Buffer.alloc(32, 2).toString("base64");
      const s1 = new CredentialsStore({ credentialsDir: dir2, encryptionKey: k1 });
      s1.set("default", { key: "x", username: "u", password: "secret" });
      s1.close();
      const s2 = new CredentialsStore({ credentialsDir: dir2, encryptionKey: k2 });
      expect(() => s2.get("default", "x")).toThrow();
      s2.close();
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("close is idempotent", () => {
    const store = new CredentialsStore({ credentialsDir: dir });
    store.close();
    expect(() => store.close()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run credentials/store
```

- [ ] **Step 3: Implement CredentialsStore**

`orchestrator/src/credentials/store.ts`:

```typescript
import Database, { type Database as Db } from "better-sqlite3";
import { mkdirSync, chmodSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { isValidCredentialKey, type Credential, type CredentialKey } from "./types.js";

export interface CredentialsStoreOptions {
  credentialsDir: string;
  /** Same base64 32-byte key the vault uses. When set, password and
   *  totp_secret are AES-256-GCM encrypted before storage. */
  encryptionKey?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('version', '1');
INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('encrypted', '0');

CREATE TABLE IF NOT EXISTS credentials (
  key         TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  password    TEXT NOT NULL,
  totp_secret TEXT
);
`;

interface CredentialRow {
  key: string;
  username: string;
  password: string;
  totp_secret: string | null;
}

const ENCRYPTED_PREFIX = "enc::";

export class CredentialsStore {
  private readonly pool = new Map<string, Db>();
  private closed = false;
  private cachedKey?: Buffer;

  constructor(private readonly opts: CredentialsStoreOptions) {
    mkdirSync(opts.credentialsDir, { recursive: true });
    try { chmodSync(opts.credentialsDir, 0o700); } catch { /* non-fatal */ }
  }

  set(profile: string, cred: Credential): void {
    if (!isValidCredentialKey(cred.key)) {
      throw new Error(`Invalid credential key: ${JSON.stringify(cred.key)}`);
    }
    const db = this.dbFor(profile);
    db.prepare(`
      INSERT INTO credentials (key, username, password, totp_secret)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        username=excluded.username,
        password=excluded.password,
        totp_secret=excluded.totp_secret
    `).run(
      cred.key,
      cred.username,
      this.encrypt(cred.password),
      cred.totp_secret ? this.encrypt(cred.totp_secret) : null
    );
  }

  get(profile: string, key: CredentialKey): Credential | null {
    const file = this.profileFile(profile);
    if (!existsSync(file)) return null;
    const db = this.dbFor(profile);
    const row = db.prepare(`SELECT * FROM credentials WHERE key = ?`).get(key) as CredentialRow | undefined;
    if (!row) return null;
    return {
      key: row.key,
      username: row.username,
      password: this.decrypt(row.password),
      totp_secret: row.totp_secret ? this.decrypt(row.totp_secret) : undefined,
    };
  }

  /** Enumerate credentials in `profile` — WITHOUT passwords or totp_secret. */
  list(profile: string): Array<{ key: string; username: string }> {
    const file = this.profileFile(profile);
    if (!existsSync(file)) return [];
    const db = this.dbFor(profile);
    return db
      .prepare(`SELECT key, username FROM credentials ORDER BY key`)
      .all() as Array<{ key: string; username: string }>;
  }

  remove(profile: string, key: CredentialKey): void {
    const file = this.profileFile(profile);
    if (!existsSync(file)) return;
    const db = this.dbFor(profile);
    db.prepare(`DELETE FROM credentials WHERE key = ?`).run(key);
  }

  listProfiles(): string[] {
    if (!existsSync(this.opts.credentialsDir)) return [];
    return readdirSync(this.opts.credentialsDir)
      .filter((f) => f.endsWith(".db"))
      .map((f) => f.slice(0, -3));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const db of this.pool.values()) {
      try { db.close(); } catch { /* ignore */ }
    }
    this.pool.clear();
  }

  private dbFor(profile: string): Db {
    if (this.closed) throw new Error("CredentialsStore: already closed");
    const cached = this.pool.get(profile);
    if (cached) return cached;
    const path = this.profileFile(profile);
    const isNew = !existsSync(path);
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.exec(SCHEMA);
    if (isNew) {
      try { chmodSync(path, 0o600); } catch { /* windows */ }
    }
    const encrypted = (db
      .prepare(`SELECT value FROM schema_meta WHERE key='encrypted'`)
      .get() as { value: string } | undefined)?.value ?? "0";
    if (encrypted === "1" && !this.opts.encryptionKey) {
      throw new Error(`Credentials profile "${profile}" was encrypted; HUSK_VAULT_KEY must be set`);
    }
    if (encrypted === "0" && this.opts.encryptionKey) {
      db.prepare(`UPDATE schema_meta SET value='1' WHERE key='encrypted'`).run();
    }
    this.pool.set(profile, db);
    return db;
  }

  private profileFile(profile: string): string {
    return join(this.opts.credentialsDir, `${profile}.db`);
  }

  private encrypt(plain: string): string {
    if (!this.opts.encryptionKey) return plain;
    const key = this.deriveKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ENCRYPTED_PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
  }

  private decrypt(stored: string): string {
    if (!this.opts.encryptionKey) {
      if (stored.startsWith(ENCRYPTED_PREFIX)) {
        throw new Error("CredentialsStore: stored value is encrypted but no HUSK_VAULT_KEY provided");
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

  private deriveKey(): Buffer {
    if (this.cachedKey) return this.cachedKey;
    const raw = Buffer.from(this.opts.encryptionKey!, "base64");
    this.cachedKey = scryptSync(raw, "husk-credentials-v1", 32);
    return this.cachedKey;
  }
}
```

Note: the scrypt salt is `husk-credentials-v1` (different from vault's `husk-vault-v1`). Same `HUSK_VAULT_KEY` env var, different derived key. This is intentional domain separation — a vault-key compromise doesn't trivially leak credentials.

- [ ] **Step 2: Update credentials/index.ts**

```typescript
export type { Credential, CredentialKey } from "./types.js";
export { isValidCredentialKey } from "./types.js";
export { CredentialsStore } from "./store.js";
export type { CredentialsStoreOptions } from "./store.js";
```

- [ ] **Step 3: Verify + commit**

```
pnpm --filter husk-orchestrator vitest run credentials
pnpm --filter husk-orchestrator typecheck
git add orchestrator/src/credentials/store.ts orchestrator/src/credentials/index.ts orchestrator/tests/credentials/store.test.ts
git commit -m "feat(credentials): CredentialsStore — per-profile SQLite with AES-GCM"
```

Expected: 10 store tests + 3 type tests = 13 credentials tests pass.

---

## Task 3: RFC 6238 TOTP Generator

**Files:**
- Create: `orchestrator/src/auth/totp.ts`
- Create: `orchestrator/src/auth/index.ts`
- Create: `orchestrator/tests/auth/totp.test.ts`

- [ ] **Step 1: Write failing tests**

`orchestrator/tests/auth/totp.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { totpCode, decodeBase32 } from "../../src/auth/totp.js";

// RFC 6238 Appendix B test vectors (HMAC-SHA1, 8-digit codes).
// We use 6-digit codes (the common case); known-good 6-digit
// truncations of the same vectors are below.
const SECRET_HEX = "3132333435363738393031323334353637383930";
const SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32(b"12345678901234567890")

describe("decodeBase32", () => {
  it("decodes a standard base32 string", () => {
    const buf = decodeBase32(SECRET_BASE32);
    expect(buf.toString("hex")).toBe(SECRET_HEX);
  });

  it("tolerates lowercase and spaces", () => {
    const buf = decodeBase32("gezd gnbv gy3t qojq gezd gnbv gy3t qojq");
    expect(buf.toString("hex")).toBe(SECRET_HEX);
  });

  it("strips trailing padding", () => {
    const buf = decodeBase32("MFRGG===");
    expect(buf.toString("ascii")).toBe("abc");
  });
});

describe("totpCode (RFC 6238)", () => {
  // RFC 6238 Appendix B, T = 59s → counter = 1 → 8-digit HMAC-SHA1 code 94287082.
  // 6-digit truncation: 287082.
  it("matches RFC 6238 vector at T=59 with SHA1", () => {
    const code = totpCode(SECRET_BASE32, { now: 59 * 1000, digits: 6, period: 30 });
    expect(code).toBe("287082");
  });

  it("matches RFC 6238 vector at T=1111111109", () => {
    // 8-digit: 07081804 → 6-digit truncation: 081804
    const code = totpCode(SECRET_BASE32, { now: 1111111109 * 1000, digits: 6, period: 30 });
    expect(code).toBe("081804");
  });

  it("matches RFC 6238 vector at T=1234567890", () => {
    // 8-digit: 89005924 → 6-digit truncation: 005924
    const code = totpCode(SECRET_BASE32, { now: 1234567890 * 1000, digits: 6, period: 30 });
    expect(code).toBe("005924");
  });

  it("uses Date.now() when `now` is omitted (smoke check format)", () => {
    const code = totpCode(SECRET_BASE32);
    expect(code).toMatch(/^\d{6}$/);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run auth/totp
```

- [ ] **Step 3: Implement**

`orchestrator/src/auth/totp.ts`:

```typescript
import { createHmac } from "node:crypto";

/**
 * Decode an RFC 4648 base32 string into bytes. Tolerates lowercase, spaces,
 * and trailing `=` padding.
 */
export function decodeBase32(input: string): Buffer {
  const cleaned = input.replace(/\s+/g, "").replace(/=+$/, "").toUpperCase();
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`decodeBase32: invalid character "${ch}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export interface TotpOptions {
  /** Unix milliseconds. Default: `Date.now()`. Tests inject. */
  now?: number;
  /** Number of digits in the code. Standard is 6. */
  digits?: number;
  /** Period in seconds. Standard is 30. */
  period?: number;
}

/**
 * Generate a TOTP code (RFC 6238) from a base32-encoded secret.
 * HMAC-SHA1 is the standard algorithm; some sites use SHA256/SHA512 (not v0).
 */
export function totpCode(secret: string, opts: TotpOptions = {}): string {
  const now = opts.now ?? Date.now();
  const period = opts.period ?? 30;
  const digits = opts.digits ?? 6;
  const counter = Math.floor(now / 1000 / period);

  // 8-byte big-endian counter
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const key = decodeBase32(secret);
  const hmac = createHmac("sha1", key).update(counterBuf).digest();

  // Dynamic truncation (RFC 4226 §5.3)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const mod = 10 ** digits;
  return String(bin % mod).padStart(digits, "0");
}
```

`orchestrator/src/auth/index.ts`:

```typescript
export { totpCode, decodeBase32 } from "./totp.js";
export type { TotpOptions } from "./totp.js";
```

- [ ] **Step 4: Verify + commit**

```
pnpm --filter husk-orchestrator vitest run auth/totp
pnpm --filter husk-orchestrator typecheck
git add orchestrator/src/auth/totp.ts orchestrator/src/auth/index.ts orchestrator/tests/auth/totp.test.ts
git commit -m "feat(auth): RFC 6238 TOTP generator + base32 decoder"
```

Expected: 7 tests pass (3 base32 + 4 TOTP).

---

## Task 4: Login Form Locator

**Files:**
- Create: `orchestrator/src/auth/login-locator.ts`
- Modify: `orchestrator/src/auth/index.ts` (re-export)
- Create: `orchestrator/tests/auth/login-locator.test.ts`

- [ ] **Step 1: Write failing tests**

`orchestrator/tests/auth/login-locator.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { locateLoginFields } from "../../src/auth/login-locator.js";
import type { Snapshot } from "../../src/snapshot/types.js";

function snap(rootKids: Array<{ i: string; r: string; n: string; s?: ("v"|"e"|"c"|"f"|"d")[] }>): Snapshot {
  return {
    v: 1, url: "https://x.test/", count: rootKids.length + 1,
    root: {
      i: "root:1", r: "RootWebArea", n: "Sign in", s: ["v"],
      c: rootKids.map((n) => ({ ...n, s: n.s ?? ["v", "e"] })),
    },
  };
}

describe("locateLoginFields", () => {
  it("finds username/password/submit on a vanilla form (textbox 'Username', textbox 'Password', button 'Sign in')", () => {
    const s = snap([
      { i: "tb:u", r: "textbox", n: "Username" },
      { i: "tb:p", r: "textbox", n: "Password" },
      { i: "btn:s", r: "button", n: "Sign in" },
    ]);
    const r = locateLoginFields(s);
    expect(r.username?.i).toBe("tb:u");
    expect(r.password?.i).toBe("tb:p");
    expect(r.submit?.i).toBe("btn:s");
  });

  it("recognises 'Email' as a username synonym", () => {
    const s = snap([
      { i: "tb:e", r: "textbox", n: "Email" },
      { i: "tb:p", r: "textbox", n: "Password" },
      { i: "btn:s", r: "button", n: "Log in" },
    ]);
    const r = locateLoginFields(s);
    expect(r.username?.i).toBe("tb:e");
    expect(r.submit?.i).toBe("btn:s");
  });

  it("recognises searchbox/combobox as username field types", () => {
    const s = snap([
      { i: "cb:u", r: "combobox", n: "Username" },
      { i: "tb:p", r: "textbox", n: "Password" },
      { i: "btn:s", r: "button", n: "Submit" },
    ]);
    expect(locateLoginFields(s).username?.i).toBe("cb:u");
  });

  it("returns null fields when not found", () => {
    const s = snap([
      { i: "h:1", r: "heading", n: "Not a login page" },
    ]);
    const r = locateLoginFields(s);
    expect(r.username).toBeNull();
    expect(r.password).toBeNull();
    expect(r.submit).toBeNull();
  });

  it("requires the password textbox to have a name matching /password/i", () => {
    const s = snap([
      { i: "tb:u", r: "textbox", n: "Email" },
      { i: "tb:x", r: "textbox", n: "Birthday" },
      { i: "btn:s", r: "button", n: "Submit" },
    ]);
    const r = locateLoginFields(s);
    expect(r.password).toBeNull();
  });

  it("totp field heuristic finds 'One-time code' / '2FA' / 'Verification'", () => {
    const s = snap([
      { i: "tb:c", r: "textbox", n: "One-time code" },
      { i: "btn:s", r: "button", n: "Verify" },
    ]);
    const r = locateLoginFields(s);
    expect(r.totp?.i).toBe("tb:c");
    expect(r.submit?.i).toBe("btn:s");
  });

  it("submit fallback uses /verify|continue/i when /sign in|log in|submit/i absent", () => {
    const s = snap([
      { i: "tb:u", r: "textbox", n: "Username" },
      { i: "tb:p", r: "textbox", n: "Password" },
      { i: "btn:s", r: "button", n: "Continue" },
    ]);
    expect(locateLoginFields(s).submit?.i).toBe("btn:s");
  });

  it("prefers visible enabled buttons over disabled ones", () => {
    const s = snap([
      { i: "tb:u", r: "textbox", n: "Username" },
      { i: "tb:p", r: "textbox", n: "Password" },
      { i: "btn:d", r: "button", n: "Sign in", s: ["v", "d"] },
      { i: "btn:e", r: "button", n: "Sign in" },
    ]);
    expect(locateLoginFields(s).submit?.i).toBe("btn:e");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run auth/login-locator
```

- [ ] **Step 3: Implement**

`orchestrator/src/auth/login-locator.ts`:

```typescript
import type { Snapshot, SnapshotNode } from "../snapshot/types.js";

export interface LoginFields {
  /** Username/email field (textbox/combobox/searchbox). */
  username: SnapshotNode | null;
  /** Password field. Required for a login flow. */
  password: SnapshotNode | null;
  /** Submit button (or button-like). */
  submit: SnapshotNode | null;
  /** Optional TOTP / 2FA code field. */
  totp: SnapshotNode | null;
}

const USERNAME_RE = /\b(user(name)?|e[\s-]?mail|login|account|handle|sign[\s-]?in)\b/i;
const PASSWORD_RE = /\bpassword\b/i;
const SUBMIT_PRIMARY_RE = /\b(sign\s?in|log\s?in|submit)\b/i;
const SUBMIT_FALLBACK_RE = /\b(verify|continue|next|enter|proceed)\b/i;
const TOTP_RE = /\b(one[\s-]?time|2fa|two[\s-]?factor|authenticator|verification|tot[pj]|code)\b/i;

const USERNAME_ROLES = new Set(["textbox", "combobox", "searchbox"]);

function walk(node: SnapshotNode, visit: (n: SnapshotNode) => void): void {
  visit(node);
  for (const c of node.c ?? []) walk(c, visit);
}

function isEnabledVisible(n: SnapshotNode): boolean {
  return n.s.includes("v") && !n.s.includes("d");
}

export function locateLoginFields(snapshot: Snapshot): LoginFields {
  const textboxes: SnapshotNode[] = [];
  const buttons: SnapshotNode[] = [];
  walk(snapshot.root, (n) => {
    if (USERNAME_ROLES.has(n.r)) textboxes.push(n);
    else if (n.r === "button") buttons.push(n);
  });

  const password = textboxes.find((n) => PASSWORD_RE.test(n.n)) ?? null;
  // Username: any textbox-like with a username-ish name. If password is found
  // but no textbox matches USERNAME_RE, fall back to the first non-password
  // visible textbox before the password in document order.
  let username = textboxes.find((n) => n !== password && USERNAME_RE.test(n.n)) ?? null;
  if (!username && password) {
    username = textboxes.find((n) => n !== password && isEnabledVisible(n)) ?? null;
  }
  const totp = textboxes.find((n) => n !== password && n !== username && TOTP_RE.test(n.n)) ?? null;

  // Submit: prefer enabled-visible match on primary regex; fall back to fallback regex.
  const primary = buttons.filter((b) => isEnabledVisible(b) && SUBMIT_PRIMARY_RE.test(b.n));
  const fallback = buttons.filter((b) => isEnabledVisible(b) && SUBMIT_FALLBACK_RE.test(b.n));
  const submit = primary[0] ?? fallback[0] ?? null;

  return { username, password, submit, totp };
}
```

- [ ] **Step 4: Re-export + verify**

Append to `orchestrator/src/auth/index.ts`:

```typescript
export { locateLoginFields } from "./login-locator.js";
export type { LoginFields } from "./login-locator.js";
```

```
pnpm --filter husk-orchestrator vitest run auth
pnpm --filter husk-orchestrator typecheck
git add orchestrator/src/auth/login-locator.ts orchestrator/src/auth/index.ts orchestrator/tests/auth/login-locator.test.ts
git commit -m "feat(auth): login-locator — ARIA-first heuristics for login form fields"
```

Expected: 8 locator tests + 7 TOTP tests = 15 auth tests pass.

---

## Task 5: Session.login() + login-flow orchestrator

**Files:**
- Create: `orchestrator/src/auth/login-flow.ts`
- Modify: `orchestrator/src/session/session.ts` (add `login()` method)
- Create: `orchestrator/tests/auth/login-flow.test.ts`

- [ ] **Step 1: Write failing tests**

`orchestrator/tests/auth/login-flow.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { performLogin, type LoginInput } from "../../src/auth/login-flow.js";
import type { Snapshot } from "../../src/snapshot/types.js";

function loginSnap(): Snapshot {
  return {
    v: 1, url: "https://x.test/login", count: 4,
    root: {
      i: "root:1", r: "RootWebArea", n: "Sign in", s: ["v"],
      c: [
        { i: "tb:u", r: "textbox", n: "Email", s: ["v", "e"] },
        { i: "tb:p", r: "textbox", n: "Password", s: ["v", "e"] },
        { i: "btn:s", r: "button", n: "Sign in", s: ["v", "e"] },
      ],
    },
  };
}

function postLoginSnap(): Snapshot {
  return {
    v: 1, url: "https://x.test/dashboard", count: 2,
    root: {
      i: "root:2", r: "RootWebArea", n: "Welcome", s: ["v"],
      c: [{ i: "h:1", r: "heading", n: "Welcome back", s: ["v"] }],
    },
  };
}

function fakeSession(snaps: Snapshot[]) {
  let calls = 0;
  const log: Array<{ method: string; args: unknown[] }> = [];
  return {
    log,
    snapshot: async () => snaps[Math.min(calls++, snaps.length - 1)],
    type: vi.fn(async (id: string, text: string) => {
      log.push({ method: "type", args: [id, text] });
      return { ok: true, warnings: [] };
    }),
    click: vi.fn(async (id: string) => {
      log.push({ method: "click", args: [id] });
      return { ok: true, warnings: [] };
    }),
    pressKey: vi.fn(async () => ({ ok: true, warnings: [] })),
    getUrl: () => snaps[Math.min(calls, snaps.length - 1)].url,
  };
}

describe("performLogin", () => {
  it("types username + password and clicks submit", async () => {
    const session = fakeSession([loginSnap(), postLoginSnap()]);
    const input: LoginInput = { username: "demo@x.test", password: "secret" };
    const r = await performLogin(session as any, input);
    expect(r.ok).toBe(true);
    expect(session.log).toEqual([
      { method: "type", args: ["tb:u", "demo@x.test"] },
      { method: "type", args: ["tb:p", "secret"] },
      { method: "click", args: ["btn:s"] },
    ]);
  });

  it("returns ok=false when login fields not found", async () => {
    const blank: Snapshot = { v: 1, url: "https://x.test/", count: 1, root: { i: "r", r: "RootWebArea", n: "Empty", s: ["v"] } };
    const session = fakeSession([blank, blank]);
    const r = await performLogin(session as any, { username: "u", password: "p" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("login_form_not_found");
  });

  it("includes TOTP code when totp field + secret are present", async () => {
    const totpSnap: Snapshot = {
      v: 1, url: "https://x.test/2fa", count: 3,
      root: {
        i: "r", r: "RootWebArea", n: "2FA", s: ["v"],
        c: [
          { i: "tb:c", r: "textbox", n: "One-time code", s: ["v", "e"] },
          { i: "btn:v", r: "button", n: "Verify", s: ["v", "e"] },
        ],
      },
    };
    const session = fakeSession([loginSnap(), totpSnap, postLoginSnap()]);
    const r = await performLogin(session as any, {
      username: "demo", password: "x", totp_code: "123456",
    });
    expect(r.ok).toBe(true);
    expect(session.log.find((c) => c.method === "type" && c.args[0] === "tb:c")?.args[1]).toBe("123456");
  });

  it("returns ok=false when post-login snapshot still shows password field (login failed)", async () => {
    const session = fakeSession([loginSnap(), loginSnap()]); // same snapshot = still on login page
    const r = await performLogin(session as any, { username: "u", password: "bad" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("login_did_not_advance");
  });

  it("returns ok=false when click rejected by watchdog", async () => {
    const session = {
      ...fakeSession([loginSnap()]),
      click: vi.fn(async () => ({
        ok: false, reason: "element_not_found", verb: "click",
        stable_id_attempted: "btn:s", candidates: [],
        snapshot_at_attempt: loginSnap(),
      })),
    };
    const r = await performLogin(session as any, { username: "u", password: "p" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("watchdog_rejected");
  });

  it("URL change to a non-login URL counts as success even if there's still a password field somewhere", async () => {
    const dashWithChangePw: Snapshot = {
      v: 1, url: "https://x.test/dashboard", count: 3,
      root: {
        i: "r", r: "RootWebArea", n: "Dashboard", s: ["v"],
        c: [
          { i: "h", r: "heading", n: "Welcome", s: ["v"] },
          { i: "tb:p", r: "textbox", n: "Current password (to change)", s: ["v", "e"] },
        ],
      },
    };
    const session = fakeSession([loginSnap(), dashWithChangePw]);
    const r = await performLogin(session as any, { username: "u", password: "p" });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run auth/login-flow
```

- [ ] **Step 3: Implement login-flow**

`orchestrator/src/auth/login-flow.ts`:

```typescript
import type { ActionResult } from "../session/session.js";
import type { Snapshot } from "../snapshot/types.js";
import { locateLoginFields } from "./login-locator.js";

export interface LoginInput {
  username: string;
  password: string;
  /** Pre-computed 6-digit TOTP code. Caller generates from the secret. */
  totp_code?: string;
}

export type LoginReason =
  | "login_form_not_found"
  | "login_did_not_advance"
  | "watchdog_rejected"
  | "totp_field_not_found";

export type LoginResult =
  | { ok: true; url_before: string; url_after: string }
  | { ok: false; reason: LoginReason; detail?: unknown };

/**
 * Minimal session shape the login flow needs. Lets us test with fakes
 * without dragging in the full Session class.
 */
export interface SessionLike {
  snapshot(): Promise<Snapshot>;
  type(stable_id: string, text: string): Promise<ActionResult>;
  click(stable_id: string): Promise<ActionResult>;
  pressKey?(key: string): Promise<ActionResult>;
}

/**
 * Drive a login flow on the current page:
 *   1. Snapshot the page; locate username/password/submit/totp fields
 *   2. Type username, password, optional TOTP (if both field and code present)
 *   3. Click submit
 *   4. Re-snapshot; declare success if URL changed OR no password field remains
 *
 * Returns `{ok: true}` only when both username and password fields existed
 * and the post-action snapshot suggests login advanced. Watchdog rejections
 * surface as `watchdog_rejected`.
 */
export async function performLogin(session: SessionLike, input: LoginInput): Promise<LoginResult> {
  const before = await session.snapshot();
  let fields = locateLoginFields(before);

  // Two flows:
  //   (a) Combined form: username + password + submit all on one page → fill all, click submit.
  //   (b) Split flow: page asks for username only first, then password on next page.
  //       For v0, only (a) is supported. (b) is documented as future work.
  if (!fields.username || !fields.password || !fields.submit) {
    // Maybe we're already on the 2FA prompt — different success path.
    if (fields.totp && input.totp_code && fields.submit) {
      return await handleTotpOnly(session, input.totp_code, before, fields);
    }
    return { ok: false, reason: "login_form_not_found" };
  }

  // 1. Type username
  const u = await session.type(fields.username.i, input.username);
  if (!u.ok) return { ok: false, reason: "watchdog_rejected", detail: u };

  // 2. Type password
  const p = await session.type(fields.password.i, input.password);
  if (!p.ok) return { ok: false, reason: "watchdog_rejected", detail: p };

  // 3. Optional inline TOTP (if the form has it co-located)
  if (fields.totp && input.totp_code) {
    const t = await session.type(fields.totp.i, input.totp_code);
    if (!t.ok) return { ok: false, reason: "watchdog_rejected", detail: t };
  }

  // 4. Click submit
  const c = await session.click(fields.submit.i);
  if (!c.ok) return { ok: false, reason: "watchdog_rejected", detail: c };

  // 5. Re-snapshot and decide
  const after = await session.snapshot();
  const url_before = before.url;
  const url_after = after.url;

  if (url_before !== url_after) {
    // URL changed — almost certainly progressed. If a TOTP field appears now
    // and we have a code, attempt the 2FA step.
    const afterFields = locateLoginFields(after);
    if (afterFields.totp && input.totp_code && afterFields.submit) {
      return await handleTotpOnly(session, input.totp_code, after, afterFields);
    }
    return { ok: true, url_before, url_after };
  }

  // URL didn't change but the password field is gone — likely XHR login that
  // updated the same page (SPA). Count as success.
  const afterFields = locateLoginFields(after);
  if (!afterFields.password) {
    return { ok: true, url_before, url_after };
  }

  return { ok: false, reason: "login_did_not_advance" };
}

async function handleTotpOnly(
  session: SessionLike,
  code: string,
  current: Snapshot,
  fields: ReturnType<typeof locateLoginFields>
): Promise<LoginResult> {
  if (!fields.totp || !fields.submit) {
    return { ok: false, reason: "totp_field_not_found" };
  }
  const t = await session.type(fields.totp.i, code);
  if (!t.ok) return { ok: false, reason: "watchdog_rejected", detail: t };
  const c = await session.click(fields.submit.i);
  if (!c.ok) return { ok: false, reason: "watchdog_rejected", detail: c };
  const after = await session.snapshot();
  if (after.url !== current.url || !locateLoginFields(after).password) {
    return { ok: true, url_before: current.url, url_after: after.url };
  }
  return { ok: false, reason: "login_did_not_advance" };
}
```

- [ ] **Step 4: Add Session.login() method**

Modify `orchestrator/src/session/session.ts`. Add imports:

```typescript
import { performLogin, type LoginInput, type LoginResult } from "../auth/login-flow.js";
import { totpCode } from "../auth/totp.js";
```

Add method to the Session class:

```typescript
async login(input: LoginInput & { totp_secret?: string }): Promise<LoginResult> {
  // If totp_secret supplied but no precomputed code, generate one.
  const code = input.totp_code ?? (input.totp_secret ? totpCode(input.totp_secret) : undefined);
  return await performLogin(
    {
      snapshot: () => this.snapshot(),
      type: (id, text) => this.type(id, text),
      click: (id) => this.click(id),
      pressKey: (key) => this.press_key(key),
    },
    { username: input.username, password: input.password, totp_code: code }
  );
}
```

Also re-export `LoginResult` + `LoginInput` from session.ts so external callers can use them.

- [ ] **Step 5: Append to auth/index.ts**

```typescript
export { performLogin } from "./login-flow.js";
export type { LoginInput, LoginResult, LoginReason, SessionLike } from "./login-flow.js";
```

- [ ] **Step 6: Verify + commit**

```
pnpm --filter husk-orchestrator vitest run
pnpm --filter husk-orchestrator typecheck
git add orchestrator/src/auth/login-flow.ts orchestrator/src/auth/index.ts \
        orchestrator/src/session/session.ts orchestrator/tests/auth/login-flow.test.ts
git commit -m "feat(session): Session.login() — drives username/password/TOTP form"
```

Expected: 6 login-flow tests + all prior pass.

---

## Task 6: HTTP `credentials_*` + `login` Methods

**Files:**
- Modify: `orchestrator/src/http/methods.ts`
- Modify: `orchestrator/src/http/server.ts`
- Modify: `orchestrator/src/index.ts`
- Create: `orchestrator/tests/http/credentials-methods.test.ts`

- [ ] **Step 1: Write failing tests**

`orchestrator/tests/http/credentials-methods.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { METHODS } from "../../src/http/methods.js";
import { SessionManager } from "../../src/session/manager.js";
import { CredentialsStore } from "../../src/credentials/store.js";
import { VaultStore } from "../../src/vault/store.js";
import type { Session } from "../../src/session/session.js";

function makeCtx(creds: CredentialsStore, vault: VaultStore, sessionLogin?: (input: any) => Promise<any>) {
  const sm = new SessionManager(async () => ({
    close: async () => {},
    login: sessionLogin ?? (async () => ({ ok: true, url_before: "a", url_after: "b" })),
  }) as unknown as Session);
  return { sessions: sm, version: "0.0.0", vault, credentials: creds };
}

describe("HTTP credentials methods", () => {
  let dir: string;
  let creds: CredentialsStore;
  let vault: VaultStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "husk-creds-http-"));
    creds = new CredentialsStore({ credentialsDir: join(dir, "creds") });
    vault = new VaultStore({ vaultDir: join(dir, "vault") });
  });
  afterEach(() => {
    creds.close();
    vault.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("credentials_set stores a credential under profile + key", async () => {
    const ctx = makeCtx(creds, vault);
    await METHODS.credentials_set({ profile: "default", key: "github.com", username: "demo", password: "secret" }, ctx);
    const got = creds.get("default", "github.com");
    expect(got?.username).toBe("demo");
    expect(got?.password).toBe("secret");
  });

  it("credentials_set accepts optional totp_secret", async () => {
    const ctx = makeCtx(creds, vault);
    await METHODS.credentials_set({ profile: "default", key: "x", username: "u", password: "p", totp_secret: "ABCD1234" }, ctx);
    expect(creds.get("default", "x")?.totp_secret).toBe("ABCD1234");
  });

  it("credentials_list returns { key, username } pairs (no passwords)", async () => {
    creds.set("default", { key: "a", username: "ua", password: "pa" });
    creds.set("default", { key: "b", username: "ub", password: "pb" });
    const ctx = makeCtx(creds, vault);
    const r = (await METHODS.credentials_list({ profile: "default" }, ctx)) as { credentials: Array<{ key: string; username: string; password?: string }> };
    expect(r.credentials.length).toBe(2);
    for (const c of r.credentials) expect(c.password).toBeUndefined();
  });

  it("credentials_remove deletes by key", async () => {
    creds.set("default", { key: "a", username: "ua", password: "pa" });
    creds.set("default", { key: "b", username: "ub", password: "pb" });
    const ctx = makeCtx(creds, vault);
    await METHODS.credentials_remove({ profile: "default", key: "a" }, ctx);
    expect(creds.list("default").map((c) => c.key)).toEqual(["b"]);
  });

  it("credentials_list_profiles enumerates profile DB files", async () => {
    creds.set("default", { key: "a", username: "u", password: "p" });
    creds.set("work", { key: "b", username: "u", password: "p" });
    const ctx = makeCtx(creds, vault);
    const r = (await METHODS.credentials_list_profiles({}, ctx)) as { profiles: string[] };
    expect(r.profiles.sort()).toEqual(["default", "work"]);
  });

  it("login looks up credentials by profile+key and forwards to Session.login", async () => {
    creds.set("default", { key: "github.com", username: "demo", password: "secret" });
    const loginSpy = vi.fn(async () => ({ ok: true, url_before: "https://x", url_after: "https://x/dash" }));
    const sm = new SessionManager(async () => ({
      close: async () => {},
      login: loginSpy,
    }) as unknown as Session);
    const ctx = { sessions: sm, version: "0.0.0", vault, credentials: creds };
    const sid = await sm.create();
    const r = await METHODS.login({ session_id: sid, profile: "default", key: "github.com" }, ctx);
    expect((r as { ok: boolean }).ok).toBe(true);
    expect(loginSpy).toHaveBeenCalledWith({
      username: "demo", password: "secret", totp_secret: undefined,
    });
  });

  it("login returns ok:false with reason=credential_not_found when key absent", async () => {
    const ctx = makeCtx(creds, vault);
    const sid = await ctx.sessions.create();
    const r = (await METHODS.login({ session_id: sid, profile: "default", key: "missing.com" }, ctx)) as { ok: boolean; reason: string };
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("credential_not_found");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run http/credentials-methods
```

- [ ] **Step 3: Extend MethodContext + add methods**

Modify `orchestrator/src/http/methods.ts`:

1. Add import:
```typescript
import type { CredentialsStore } from "../credentials/store.js";
```

2. Extend `MethodContext`:
```typescript
export interface MethodContext {
  sessions: SessionManager;
  version: string;
  vault: VaultStore;
  credentials: CredentialsStore;
}
```

3. Add inside `METHODS`:
```typescript
async credentials_set(
  params: { profile: string; key: string; username: string; password: string; totp_secret?: string },
  ctx: MethodContext
) {
  ctx.credentials.set(params.profile, {
    key: params.key,
    username: params.username,
    password: params.password,
    totp_secret: params.totp_secret,
  });
  return { ok: true };
},

async credentials_remove(params: { profile: string; key: string }, ctx: MethodContext) {
  ctx.credentials.remove(params.profile, params.key);
  return { ok: true };
},

async credentials_list(params: { profile: string }, ctx: MethodContext) {
  return { credentials: ctx.credentials.list(params.profile) };
},

async credentials_list_profiles(_params: unknown, ctx: MethodContext) {
  return { profiles: ctx.credentials.listProfiles() };
},

async login(
  params: { session_id: string; profile: string; key: string },
  ctx: MethodContext
) {
  const cred = ctx.credentials.get(params.profile, params.key);
  if (!cred) {
    return { ok: false, reason: "credential_not_found", key: params.key };
  }
  const session = ctx.sessions.get(params.session_id);
  return await session.login({
    username: cred.username,
    password: cred.password,
    totp_secret: cred.totp_secret,
  });
},
```

- [ ] **Step 4: Thread credentials through server.ts + index.ts**

Modify `orchestrator/src/http/server.ts`:
1. Add `credentials: CredentialsStore` to `HuskServerOptions`.
2. Pass it into the `MethodContext` construction.

Modify `orchestrator/src/index.ts` `runServer()`:
```typescript
import { CredentialsStore } from "./credentials/store.js";

// alongside vault:
const credentialsDir = process.env.HUSK_CREDENTIALS_DIR ?? pathJoin(homedir(), ".husk", "credentials");
const credentials = new CredentialsStore({
  credentialsDir,
  encryptionKey: process.env.HUSK_VAULT_KEY,
});

// pass into createHuskServer({ ..., credentials });
// add credentials.close() to shutdown handler
```

Update existing HTTP tests that construct MethodContext — add `credentials: { ... }` stubs as needed.

- [ ] **Step 5: Verify + commit**

```
pnpm --filter husk-orchestrator vitest run
pnpm --filter husk-orchestrator typecheck
git add orchestrator/src/http/methods.ts orchestrator/src/http/server.ts orchestrator/src/index.ts \
        orchestrator/tests/http/credentials-methods.test.ts orchestrator/tests/http/
git commit -m "feat(http): credentials_* + login JSON-RPC methods"
```

Expected: 7 new tests pass.

---

## Task 7: TS SDK `Husk.credentials` + `Session.login()`

**Files:**
- Modify: `sdk-ts/src/session.ts` (add `login()` method)
- Modify: `sdk-ts/src/index.ts` (add `CredentialsApi` + `Husk.credentials`)
- Modify: `sdk-ts/src/types.ts` (add `Credential`, `LoginResult` types)
- Create: `sdk-ts/tests/credentials.test.ts`

- [ ] **Step 1: Write failing tests**

`sdk-ts/tests/credentials.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { Husk } from "../src/index.js";

function makeMockFetch(routes: Record<string, (params: Record<string, unknown>) => unknown>) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const handler = routes[body.method];
    if (!handler) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: `No: ${body.method}` } }), { status: 200 });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: handler(body.params) }), { status: 200 });
  });
}

describe("Husk credentials + login", () => {
  it("credentials.set calls credentials_set", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const fetchMock = makeMockFetch({
      credentials_set: (p) => { calls.push({ method: "credentials_set", params: p }); return { ok: true }; },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    await h.credentials.set("default", { key: "github.com", username: "demo", password: "secret" });
    expect(calls[0].params).toEqual({ profile: "default", key: "github.com", username: "demo", password: "secret", totp_secret: undefined });
  });

  it("credentials.set forwards totp_secret when provided", async () => {
    const calls: Array<{ params: unknown }> = [];
    const fetchMock = makeMockFetch({
      credentials_set: (p) => { calls.push({ params: p }); return { ok: true }; },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    await h.credentials.set("default", { key: "x", username: "u", password: "p", totp_secret: "ABCD1234" });
    expect((calls[0].params as { totp_secret?: string }).totp_secret).toBe("ABCD1234");
  });

  it("credentials.list returns [{key, username}] entries", async () => {
    const fetchMock = makeMockFetch({
      credentials_list: () => ({ credentials: [{ key: "a", username: "ua" }, { key: "b", username: "ub" }] }),
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    const got = await h.credentials.list("default");
    expect(got.map((c) => c.key)).toEqual(["a", "b"]);
  });

  it("credentials.remove calls credentials_remove", async () => {
    const calls: Array<{ params: unknown }> = [];
    const fetchMock = makeMockFetch({
      credentials_remove: (p) => { calls.push({ params: p }); return { ok: true }; },
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    await h.credentials.remove("default", "github.com");
    expect(calls[0].params).toEqual({ profile: "default", key: "github.com" });
  });

  it("session.login(profile, key) calls login RPC and returns the result", async () => {
    const fetchMock = makeMockFetch({
      create_session: () => ({ session_id: "s1" }),
      login: () => ({ ok: true, url_before: "https://x/login", url_after: "https://x/dash" }),
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    const s = await h.createSession();
    const r = await s.login({ profile: "default", key: "github.com" });
    expect(r.ok).toBe(true);
  });

  it("session.login forwards rejection (credential_not_found) verbatim", async () => {
    const fetchMock = makeMockFetch({
      create_session: () => ({ session_id: "s1" }),
      login: () => ({ ok: false, reason: "credential_not_found", key: "missing" }),
    });
    const h = new Husk({ baseUrl: "http://x.test", fetch: fetchMock as unknown as typeof fetch });
    const s = await h.createSession();
    const r = await s.login({ profile: "default", key: "missing" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("credential_not_found");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```
pnpm --filter @husk/sdk vitest run credentials
```

- [ ] **Step 3: Add Credential type + LoginResult**

Append to `sdk-ts/src/types.ts`:

```typescript
export interface Credential {
  key: string;
  username: string;
  password: string;
  totp_secret?: string;
}

export type LoginReason =
  | "login_form_not_found"
  | "login_did_not_advance"
  | "watchdog_rejected"
  | "totp_field_not_found"
  | "credential_not_found";

export type LoginResult =
  | { ok: true; url_before: string; url_after: string }
  | { ok: false; reason: LoginReason; key?: string; detail?: unknown };
```

- [ ] **Step 4: Extend Session**

Modify `sdk-ts/src/session.ts`:

```typescript
import type { ActionResult, Snapshot, SnapshotDiff, LoginResult } from "./types.js";

// ... existing class ...

async login(args: { profile: string; key: string }): Promise<LoginResult> {
  return await this.client.call<LoginResult>("login", {
    session_id: this.id,
    profile: args.profile,
    key: args.key,
  });
}
```

- [ ] **Step 5: Add CredentialsApi + Husk.credentials**

Modify `sdk-ts/src/index.ts`:

```typescript
class CredentialsApi {
  constructor(private readonly client: JsonRpcClient) {}

  async set(profile: string, cred: { key: string; username: string; password: string; totp_secret?: string }): Promise<void> {
    await this.client.call("credentials_set", {
      profile,
      key: cred.key,
      username: cred.username,
      password: cred.password,
      totp_secret: cred.totp_secret,
    });
  }

  async list(profile: string): Promise<Array<{ key: string; username: string }>> {
    const r = await this.client.call<{ credentials: Array<{ key: string; username: string }> }>("credentials_list", { profile });
    return r.credentials;
  }

  async listProfiles(): Promise<string[]> {
    const r = await this.client.call<{ profiles: string[] }>("credentials_list_profiles", {});
    return r.profiles;
  }

  async remove(profile: string, key: string): Promise<void> {
    await this.client.call("credentials_remove", { profile, key });
  }
}

export { CredentialsApi };
```

And on `Husk`:
```typescript
public readonly credentials: CredentialsApi;

// in constructor:
this.credentials = new CredentialsApi(this.client);
```

- [ ] **Step 6: Verify + commit**

```
pnpm --filter @husk/sdk vitest run
pnpm --filter @husk/sdk typecheck
git add sdk-ts/src/session.ts sdk-ts/src/index.ts sdk-ts/src/types.ts sdk-ts/tests/credentials.test.ts
git commit -m "feat(sdk-ts): Husk.credentials + Session.login()"
```

Expected: 6 new tests pass.

---

## Task 8: Python SDK `Husk.credentials` + `Session.login()`

**Files:**
- Create: `sdk-py/husk/_credentials.py`
- Modify: `sdk-py/husk/_session.py`
- Modify: `sdk-py/husk/_types.py` (add Credential, LoginResult)
- Modify: `sdk-py/husk/__init__.py`
- Create: `sdk-py/tests/test_credentials.py`

Pattern mirrors T7 verbatim. Test file structure follows existing `sdk-py/tests/test_vault.py`.

- [ ] **Step 1: Write failing tests**

`sdk-py/tests/test_credentials.py`:

```python
from __future__ import annotations
import json
from typing import Callable
import pytest
import httpx
from husk import Husk


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


async def test_credentials_set_forwards_all_fields() -> None:
    captured: list[dict] = []
    h = make_husk({"credentials_set": lambda p: (captured.append(p), {"ok": True})[1]})
    async with h:
        await h.credentials.set("default", key="github.com", username="demo", password="secret", totp_secret="ABCD1234")
    assert captured[0] == {"profile": "default", "key": "github.com", "username": "demo", "password": "secret", "totp_secret": "ABCD1234"}


async def test_credentials_set_omits_totp_when_unspecified() -> None:
    captured: list[dict] = []
    h = make_husk({"credentials_set": lambda p: (captured.append(p), {"ok": True})[1]})
    async with h:
        await h.credentials.set("default", key="github.com", username="demo", password="secret")
    assert captured[0].get("totp_secret") is None


async def test_credentials_list() -> None:
    h = make_husk({"credentials_list": lambda _: {"credentials": [{"key": "a", "username": "ua"}, {"key": "b", "username": "ub"}]}})
    async with h:
        got = await h.credentials.list("default")
    assert [c["key"] for c in got] == ["a", "b"]


async def test_credentials_remove() -> None:
    captured: list[dict] = []
    h = make_husk({"credentials_remove": lambda p: (captured.append(p), {"ok": True})[1]})
    async with h:
        await h.credentials.remove("default", "github.com")
    assert captured[0] == {"profile": "default", "key": "github.com"}


async def test_session_login_success() -> None:
    h = make_husk({
        "create_session": lambda _: {"session_id": "s1"},
        "login": lambda _: {"ok": True, "url_before": "https://x/login", "url_after": "https://x/dash"},
    })
    async with h:
        s = await h.create_session()
        r = await s.login(profile="default", key="github.com")
    assert r["ok"] is True
    assert r["url_after"] == "https://x/dash"


async def test_session_login_credential_not_found() -> None:
    h = make_husk({
        "create_session": lambda _: {"session_id": "s1"},
        "login": lambda _: {"ok": False, "reason": "credential_not_found", "key": "missing"},
    })
    async with h:
        s = await h.create_session()
        r = await s.login(profile="default", key="missing")
    assert r["ok"] is False
    assert r["reason"] == "credential_not_found"
```

- [ ] **Step 2: Run, verify FAIL**

```
cd sdk-py && uv run python -m pytest tests/test_credentials.py
```

- [ ] **Step 3: Implement**

`sdk-py/husk/_credentials.py`:

```python
"""Credentials namespace for Husk SDK."""
from __future__ import annotations

from typing import Any, Optional

from ._transport import JsonRpcClient


class CredentialsApi:
    """Credential storage operations. Access via `Husk.credentials`."""

    def __init__(self, client: JsonRpcClient) -> None:
        self._client = client

    async def set(
        self,
        profile: str,
        *,
        key: str,
        username: str,
        password: str,
        totp_secret: Optional[str] = None,
    ) -> None:
        await self._client.call("credentials_set", {
            "profile": profile,
            "key": key,
            "username": username,
            "password": password,
            "totp_secret": totp_secret,
        })

    async def list(self, profile: str) -> list[dict[str, Any]]:
        r = await self._client.call("credentials_list", {"profile": profile})
        return list(r["credentials"])

    async def list_profiles(self) -> list[str]:
        r = await self._client.call("credentials_list_profiles", {})
        return list(r["profiles"])

    async def remove(self, profile: str, key: str) -> None:
        await self._client.call("credentials_remove", {"profile": profile, "key": key})
```

Add login() to `sdk-py/husk/_session.py`:

```python
async def login(self, *, profile: str, key: str) -> dict[str, Any]:
    return await self._client.call("login", {
        "session_id": self._id,
        "profile": profile,
        "key": key,
    })
```

Modify `sdk-py/husk/__init__.py`:

```python
from ._credentials import CredentialsApi

# in Husk.__init__:
self.credentials = CredentialsApi(self._client)

# add CredentialsApi to __all__
```

- [ ] **Step 4: Verify + commit**

```
cd sdk-py && uv run python -m pytest
git add sdk-py/husk/_credentials.py sdk-py/husk/_session.py sdk-py/husk/__init__.py sdk-py/tests/test_credentials.py
git commit -m "feat(sdk-py): Husk.credentials + Session.login()"
```

Expected: 6 new tests pass.

---

## Task 9: MCP `husk_login` + `husk_credentials_set` Tools

**Files:**
- Modify: `mcp/src/tool-surface.ts`
- Modify: `mcp/tests/tool-surface.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `mcp/tests/tool-surface.test.ts`:

```typescript
describe("login + credentials tools", () => {
  it("TOOL_SURFACE includes husk_login + husk_credentials_set", () => {
    const names = TOOL_SURFACE.map((t) => t.name);
    expect(names).toContain("husk_login");
    expect(names).toContain("husk_credentials_set");
  });

  it("husk_login schema requires session_id, profile, key", () => {
    const tool = TOOL_SURFACE.find((t) => t.name === "husk_login")!;
    expect(tool.inputSchema.required).toEqual(expect.arrayContaining(["session_id", "profile", "key"]));
  });

  it("handleToolCall routes husk_login to JSON-RPC login", async () => {
    const client = { call: vi.fn(async () => ({ ok: true, url_before: "a", url_after: "b" })) };
    await handleToolCall(client as any, "husk_login", { session_id: "s1", profile: "default", key: "github.com" });
    expect(client.call).toHaveBeenCalledWith("login", { session_id: "s1", profile: "default", key: "github.com" });
  });
});
```

- [ ] **Step 2: Update tool-surface.ts**

Add to `TOOL_SURFACE`:

```typescript
{
  name: "husk_login",
  description: "Husk — Log into a website using stored credentials. Reads username/password (and optional TOTP secret) from the credentials store for the given profile + key. Returns { ok, url_before, url_after } on success or { ok: false, reason } on failure.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      profile: { type: "string", description: "Credential profile name" },
      key: { type: "string", description: "Credential key (typically a hostname)" },
    },
    required: ["session_id", "profile", "key"],
  },
},
{
  name: "husk_credentials_set",
  description: "Husk — Store a credential (username + password, optionally totp_secret) under a profile + key. The credentials store is AES-encrypted if HUSK_VAULT_KEY is set.",
  inputSchema: {
    type: "object",
    properties: {
      profile: { type: "string" },
      key: { type: "string" },
      username: { type: "string" },
      password: { type: "string" },
      totp_secret: { type: "string", description: "Base32-encoded TOTP secret for 2FA-protected sites" },
    },
    required: ["profile", "key", "username", "password"],
  },
},
```

Extend `RPC_MAP`:
```typescript
husk_login: "login",
husk_credentials_set: "credentials_set",
```

- [ ] **Step 3: Verify + commit**

```
pnpm --filter @husk/mcp vitest run
pnpm --filter @husk/mcp typecheck
git add mcp/src/tool-surface.ts mcp/tests/tool-surface.test.ts
git commit -m "feat(mcp): husk_login + husk_credentials_set tools"
```

Expected: 3 new tests pass.

---

## Task 10: CLI `husk login` Interactive Prompt

**Files:**
- Modify: `orchestrator/src/index.ts` (add `login` subcommand)
- Create: `orchestrator/tests/cli/login.test.ts`

This is a setup-time command for the user to register credentials before agents use them. It prompts via stdin/stdout (no GUI).

- [ ] **Step 1: Write failing test**

`orchestrator/tests/cli/login.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CredentialsStore } from "../../src/credentials/store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const huskBin = join(__dirname, "..", "..", "dist", "index.js");

function runHusk(args: string[], stdin: string, env: Record<string, string> = {}): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("node", [huskBin, ...args], { env: { ...process.env, ...env }, encoding: "utf8", input: stdin });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

describe("husk login CLI", () => {
  it("husk login --profile P --key K stores a credential from stdin", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cli-login-"));
    try {
      // Provide username and password via stdin (one per line).
      const r = runHusk(
        ["login", "--profile", "default", "--key", "github.com"],
        "demo\nsecret\n\n", // username, password, empty totp_secret (skip)
        { HUSK_CREDENTIALS_DIR: dir }
      );
      expect(r.status).toBe(0);

      const store = new CredentialsStore({ credentialsDir: dir });
      const got = store.get("default", "github.com");
      expect(got?.username).toBe("demo");
      expect(got?.password).toBe("secret");
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("husk login captures totp_secret when supplied", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cli-login-totp-"));
    try {
      const r = runHusk(
        ["login", "--profile", "default", "--key", "x.com"],
        "user\npass\nABCD1234\n",
        { HUSK_CREDENTIALS_DIR: dir }
      );
      expect(r.status).toBe(0);
      const store = new CredentialsStore({ credentialsDir: dir });
      expect(store.get("default", "x.com")?.totp_secret).toBe("ABCD1234");
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("husk login --list shows stored credentials for a profile (without passwords)", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cli-login-list-"));
    try {
      const store = new CredentialsStore({ credentialsDir: dir });
      store.set("default", { key: "a", username: "ua", password: "p" });
      store.set("default", { key: "b", username: "ub", password: "p" });
      store.close();
      const r = runHusk(["login", "--list", "--profile", "default"], "", { HUSK_CREDENTIALS_DIR: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/a\s+ua/);
      expect(r.stdout).toMatch(/b\s+ub/);
      expect(r.stdout).not.toMatch(/password/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("husk login --remove --profile P --key K deletes a credential", () => {
    const dir = mkdtempSync(join(tmpdir(), "husk-cli-login-rm-"));
    try {
      const store = new CredentialsStore({ credentialsDir: dir });
      store.set("default", { key: "x", username: "u", password: "p" });
      store.close();
      const r = runHusk(["login", "--remove", "--profile", "default", "--key", "x"], "", { HUSK_CREDENTIALS_DIR: dir });
      expect(r.status).toBe(0);
      const check = new CredentialsStore({ credentialsDir: dir });
      expect(check.get("default", "x")).toBeNull();
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Build orchestrator**

```
pnpm --filter husk-orchestrator build
```

- [ ] **Step 3: Run, verify FAIL**

```
pnpm --filter husk-orchestrator vitest run cli/login
```

- [ ] **Step 4: Add `login` subcommand**

In `orchestrator/src/index.ts`, add a `case "login":` branch and `runLogin()`:

```typescript
async function runLogin(rest: string[]): Promise<void> {
  const args = parseLoginArgs(rest);
  const credentialsDir = process.env.HUSK_CREDENTIALS_DIR ?? pathJoin(homedir(), ".husk", "credentials");
  const store = new CredentialsStore({
    credentialsDir,
    encryptionKey: process.env.HUSK_VAULT_KEY,
  });
  try {
    if (args.list) {
      const profile = args.profile ?? "default";
      const rows = store.list(profile);
      if (rows.length === 0) {
        console.log(`No credentials in profile "${profile}".`);
      } else {
        for (const row of rows) {
          console.log(`${row.key}\t${row.username}`);
        }
      }
      return;
    }
    if (args.remove) {
      if (!args.profile || !args.key) {
        console.error("Usage: husk login --remove --profile <p> --key <k>");
        process.exit(1);
      }
      store.remove(args.profile, args.key);
      console.log(`Removed ${args.key} from ${args.profile}.`);
      return;
    }
    // Interactive set
    if (!args.profile || !args.key) {
      console.error("Usage: husk login --profile <p> --key <k>");
      process.exit(1);
    }
    const lines = await readStdinLines(3);
    const [username, password, totp_secret_raw] = lines;
    const totp_secret = totp_secret_raw && totp_secret_raw.trim() ? totp_secret_raw.trim() : undefined;
    if (!username || !password) {
      console.error("husk login: username and password required");
      process.exit(1);
    }
    store.set(args.profile, { key: args.key, username, password, totp_secret });
    console.log(`Stored credential for ${args.key} in profile ${args.profile}.`);
  } finally {
    store.close();
  }
}

interface LoginArgs {
  profile?: string;
  key?: string;
  list?: boolean;
  remove?: boolean;
}

function parseLoginArgs(rest: string[]): LoginArgs {
  const out: LoginArgs = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--profile") out.profile = rest[++i];
    else if (a === "--key") out.key = rest[++i];
    else if (a === "--list") out.list = true;
    else if (a === "--remove") out.remove = true;
    else { console.error(`husk login: unknown arg ${a}`); process.exit(1); }
  }
  return out;
}

async function readStdinLines(maxLines: number): Promise<string[]> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => chunks.push(c.toString()));
    process.stdin.on("end", () => {
      const all = chunks.join("");
      const lines = all.split(/\r?\n/);
      resolve(lines.slice(0, maxLines));
    });
  });
}
```

In the command switch, add the case:
```typescript
} else if (cmd === "login") {
  await runLogin(args.slice(1));
}
```

- [ ] **Step 5: Rebuild + verify + commit**

```
pnpm --filter husk-orchestrator build
pnpm --filter husk-orchestrator vitest run cli/login
git add orchestrator/src/index.ts orchestrator/tests/cli/login.test.ts
git commit -m "feat(cli): husk login interactive setup + --list / --remove"
```

Expected: 4 tests pass.

---

## Task 11: Real-Lightpanda Login Integration Test

**Files:**
- Modify: `orchestrator/tests/integration/login-fixture-server.ts` (add username/password validation)
- Create: `orchestrator/tests/integration/login-real-e2e.test.ts`

- [ ] **Step 1: Extend the fixture server**

Modify `orchestrator/tests/integration/login-fixture-server.ts` so the `POST /login` handler actually validates the form fields. Replace the existing POST handler with:

```typescript
import { parse as parseQuery } from "node:querystring";

// inside the createServer callback, for POST /login:
if (req.url === "/login" && req.method === "POST") {
  let body = "";
  req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
  req.on("end", () => {
    const fields = parseQuery(body);
    if (fields.user === "demo" && fields.pass === "secret") {
      res.setHeader("set-cookie", "husk_demo_session=valid; Path=/; HttpOnly");
      res.writeHead(303, { Location: "/protected" });
      res.end();
    } else {
      res.writeHead(401, { "content-type": "text/html" });
      res.end(`<!DOCTYPE html><html><body><h1>Wrong credentials</h1></body></html>`);
    }
  });
  return;
}
```

The login form HTML already submits `application/x-www-form-urlencoded`, so this captures it correctly.

- [ ] **Step 2: Write the integration test**

`orchestrator/tests/integration/login-real-e2e.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../../src/session/session.js";
import { VaultStore } from "../../src/vault/store.js";
import { CredentialsStore } from "../../src/credentials/store.js";
import { locateLightpanda } from "../../src/engine/binary.js";
import { startLoginFixture } from "./login-fixture-server.js";

const integrationOrSkip = await (async () => {
  try { await locateLightpanda(); return describe; } catch { return describe.skip; }
})();

integrationOrSkip("login real-e2e — Session.login drives the form", () => {
  it("logs in by submitting the form with stored credentials", async () => {
    const root = mkdtempSync(join(tmpdir(), "husk-login-e2e-"));
    const vault = new VaultStore({ vaultDir: join(root, "vault") });
    const creds = new CredentialsStore({ credentialsDir: join(root, "creds") });
    const fixture = await startLoginFixture();

    try {
      creds.set("default", { key: "fixture", username: "demo", password: "secret" });
      const stored = creds.get("default", "fixture")!;

      let session: Session | undefined;
      try {
        session = await Session.create({
          readinessTimeoutMs: 15_000,
          vault,
          profile: "default",
        });
        await session.goto(fixture.url);
        const r = await session.login({ username: stored.username, password: stored.password });
        expect(r.ok).toBe(true);
        if (r.ok) {
          // URL should have moved off /login (303 redirect followed to /protected)
          expect(r.url_after).not.toBe(r.url_before);
        }
        // Vault should now hold the session cookie after Session.close()
      } finally {
        await session?.close();
      }
      const cookies = vault.list("default");
      expect(cookies.find((c) => c.name === "husk_demo_session")).toBeDefined();
    } finally {
      await fixture.close();
      vault.close();
      creds.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("login returns login_did_not_advance for wrong credentials", async () => {
    const root = mkdtempSync(join(tmpdir(), "husk-login-bad-"));
    const vault = new VaultStore({ vaultDir: join(root, "vault") });
    const fixture = await startLoginFixture();

    try {
      let session: Session | undefined;
      try {
        session = await Session.create({ readinessTimeoutMs: 15_000, vault });
        await session.goto(fixture.url);
        const r = await session.login({ username: "demo", password: "WRONG" });
        expect(r.ok).toBe(false);
        if (!r.ok) {
          // Either login_did_not_advance (still on /login) or login_form_not_found
          // (server returned a 401 page with no form).
          expect(["login_did_not_advance", "login_form_not_found"]).toContain(r.reason);
        }
      } finally {
        await session?.close();
      }
    } finally {
      await fixture.close();
      vault.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
```

- [ ] **Step 3: Run with LIGHTPANDA_BIN**

```
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  pnpm --filter husk-orchestrator vitest run integration/login-real-e2e
```
Expected: 2 tests pass. The first is the M8b wedge demo — Husk drives a real login form on lightpanda.

If lightpanda's form-submit on `<button type="submit">` doesn't fire (some headless engines need `form.submit()` instead of button click), the fallback is to `pressKey("Enter")` on the password field. If you hit this, modify `performLogin` to fall back to Enter when button click doesn't produce a URL change.

- [ ] **Step 4: Run without LIGHTPANDA_BIN — verify skip**

```
pnpm --filter husk-orchestrator vitest run integration/login-real-e2e
```

- [ ] **Step 5: Run full suite, commit**

```
LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  pnpm --filter husk-orchestrator vitest run
git add orchestrator/tests/integration/login-fixture-server.ts \
        orchestrator/tests/integration/login-real-e2e.test.ts
git commit -m "test(auth): real-lightpanda login flow with credential validation"
```

---

## Task 12: Spec §5.5 + Memory Update

- [ ] **Step 1: Append §5.5 to spec**

In `docs/superpowers/specs/2026-05-13-husk-design.md`, after §5.4 (Cookie Vault), insert:

```markdown
### 5.5 Login + TOTP (M8b — shipped 2026-05-15)

Builds on M8a's cookie vault. Adds credential storage and an automated login flow.

**Credential storage:** per-profile SQLite at `~/.husk/credentials/{profile}.db` (overridable via `HUSK_CREDENTIALS_DIR`). File mode 0600. Encrypted with same `HUSK_VAULT_KEY` as the cookie vault but with a different scrypt salt (`husk-credentials-v1`) — domain separation so a vault-key compromise doesn't trivially leak credentials. Schema: `(key, username, password, totp_secret)` with `password` and `totp_secret` AES-256-GCM encrypted when a key is set.

**TOTP:** RFC 6238 with HMAC-SHA1, 30-second period, 6-digit codes. Pure Node `crypto`. Verified against RFC test vectors (T=59 → 287082, T=1111111109 → 081804, T=1234567890 → 005924).

**Login form locator:** ARIA-first heuristics over the snapshot tree.
- Username: any `textbox`/`combobox`/`searchbox` whose name matches `/user(name)?|e[\s-]?mail|login|account|handle|sign[\s-]?in/i`. Falls back to the first non-password textbox before the password field.
- Password: any `textbox` whose name matches `/password/i`.
- Submit: `button` matching `/sign in|log in|submit/i`, fallback `/verify|continue|next|enter|proceed/i`. Disabled buttons are de-prioritised.
- TOTP: `textbox` matching `/one[\s-]?time|2fa|two[\s-]?factor|authenticator|verification|tot[pj]|code/i`.

**Login flow:** `Session.login({username, password, totp_secret?})` —
1. Snapshot the current page.
2. Locate fields. If absent, return `{ok: false, reason: "login_form_not_found"}`.
3. Type username, password, optional TOTP. Watchdog rejections surface as `watchdog_rejected`.
4. Click submit.
5. Re-snapshot. Success if URL changed OR password field is gone. Otherwise `login_did_not_advance`.
6. If the post-snapshot reveals a separate 2FA prompt and a TOTP code is available, handle it (single iteration).

**HTTP methods:**
- `credentials_set` / `credentials_remove` / `credentials_list` / `credentials_list_profiles`
- `login(session_id, profile, key)` — looks up credential by `(profile, key)` and invokes `Session.login`.

**SDKs (TS + Py):** `Husk.credentials.set/list/remove/listProfiles`; `Session.login({profile, key})`.

**MCP tools:** `husk_login`, `husk_credentials_set`.

**CLI:** `husk login --profile <p> --key <k>` reads username/password/optional-totp-secret from stdin; `husk login --list --profile <p>` enumerates without passwords; `husk login --remove --profile <p> --key <k>`.

**Known gaps (M8c territory):**
- Two-page split flows (username on page 1, password on page 2) — not supported in v0. Most major auth providers do this (Google, Microsoft, Okta).
- SSO/OIDC redirect chains, SAML POST-binding.
- CAPTCHA — permanently out of scope.
- "Remember me" checkboxes — not toggled in v0.
- Account creation, password reset — login only.
```

- [ ] **Step 2: Update memory**

Edit `/Users/nirmalghinaiya/.claude/projects/-Users-nirmalghinaiya-Desktop/memory/husk-roadmap.md`. Add row to Shipped table:

```markdown
| `v0.0.9-m8b` | **Login forms + TOTP** | Per-profile credentials store (~/.husk/credentials/{profile}.db, AES-GCM via HUSK_VAULT_KEY w/ separate salt). RFC 6238 TOTP. ARIA-first login form locator (username/password/submit/totp heuristics). Session.login(creds) orchestrates fill+submit+verify. 5 new HTTP methods + Husk.credentials SDK namespace + husk_login MCP tool + `husk login` interactive CLI. Real-lightpanda integration: drives a real login form with credential validation. Handles single-page logins (~60% of login-gated sites). Split flows + SSO/SAML/MFA are M8c. ~358 tests |
```

Remove M8b from active pipeline; promote M8c.

- [ ] **Step 3: Commit spec**

```
git add docs/superpowers/specs/2026-05-13-husk-design.md
git commit -m "docs: spec §5.5 — login + TOTP contract (M8b)"
```

---

## Final Steps — Tag and Merge

- [ ] **Step A: Tag**

```bash
git tag -a v0.0.9-m8b -m "M8b — Login forms + TOTP

Credential storage at ~/.husk/credentials/{profile}.db, AES-256-GCM
encrypted with HUSK_VAULT_KEY (separate scrypt salt for domain
separation from cookie vault). RFC 6238 TOTP generation, verified
against published test vectors.

Session.login({username, password, totp_secret?}) orchestrates:
locator → fill → submit → verify. ARIA-first form-field heuristics
work on vanilla login pages plus most common variations (Email
synonym, Sign in/Log in/Submit/Verify/Continue submit text).

5 new JSON-RPC methods (credentials_set/remove/list/list_profiles +
login). Husk.credentials namespace on both SDKs. husk_login +
husk_credentials_set MCP tools. \`husk login\` interactive CLI for
one-time credential setup.

Real-lightpanda integration: drives a real login form against a
fixture server with credential validation. Session.close() captures
post-login cookies → next session resumes via M8a profile.

Handles ~60% of login-gated sites (single-page username+password forms).
Two-page split flows (Google/Microsoft/Okta) + SSO/OIDC + SAML +
MFA-with-human-loop are M8c.

Spec §5.5 amended. 358 tests total (was 296)."
```

- [ ] **Step B: Merge to main with --no-ff**

```bash
git checkout main
git merge --no-ff m8b-login-totp -m "Merge Milestone 8b (login forms + TOTP): single-page logins automated"
```

- [ ] **Step C: Push**

```bash
git push origin main v0.0.9-m8b
```

---

## Self-Review Notes

**Spec coverage (M8b slice of auth pillar §5 + §10):**
- [x] Cookie vault — M8a
- [x] Login form fill + submit — Tasks 4, 5
- [x] TOTP — Task 3
- [x] Credential storage with encryption — Task 2
- [x] Verify post-login by URL change / snapshot diff — Task 5
- [ ] Two-page split flows — **M8c**
- [ ] SSO/OIDC — **M8c**
- [ ] SAML POST-binding — **M8c**
- [ ] MFA human-in-loop — **M8c**

**Risk callouts:**
- Lightpanda's `<button type="submit">` click behaviour: if it doesn't fire the form submit, fall back to `pressKey("Enter")` on the password field. The integration test in T11 will surface this. Note in T5 to add fallback if needed.
- The locator's username heuristic is permissive — it might match a "Search" textbox if the page name contains "Sign in." Mitigated by preferring the textbox closest to the password field, but not implemented in v0. If this becomes a problem, T4's `locateLoginFields` can take a "biased to password" pass.
- TOTP only supports HMAC-SHA1 (the 95% case). HMAC-SHA256/512 sites will fail silently. Document and defer.

**No placeholders.** Every step has concrete code or commands.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-husk-m8b-login-totp.md`. Two execution options:

**1. Subagent-Driven (recommended)** — the flow that's shipped M1–M8a.

**2. Inline Execution** — `superpowers:executing-plans` in this session.

Which approach? (`1` or `2`)
