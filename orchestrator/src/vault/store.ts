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
   * AES-256-GCM encrypted before storage.
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
  value     TEXT NOT NULL,
  expires   INTEGER NOT NULL,
  size      INTEGER NOT NULL,
  http_only INTEGER NOT NULL,
  secure    INTEGER NOT NULL,
  session   INTEGER NOT NULL,
  same_site TEXT,
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

export class VaultStore {
  private readonly pool = new Map<string, Db>();
  private closed = false;

  constructor(private readonly opts: VaultStoreOptions) {
    mkdirSync(opts.vaultDir, { recursive: true });
    try { chmodSync(opts.vaultDir, 0o700); } catch { /* windows / non-fatal */ }
  }

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

  remove(profile: Profile, key: { name: string; domain: string; path: string }): void {
    const file = this.profileFile(profile);
    if (!existsSync(file)) return;
    const db = this.dbFor(profile);
    db.prepare(`DELETE FROM cookies WHERE name = ? AND domain = ? AND path = ?`).run(
      key.name, key.domain, key.path
    );
  }

  clear(profile: Profile): void {
    const file = this.profileFile(profile);
    if (!existsSync(file)) return;
    const db = this.dbFor(profile);
    db.prepare(`DELETE FROM cookies`).run();
  }

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

  private dbFor(profile: Profile): Db {
    if (this.closed) throw new Error("VaultStore: already closed");
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
    this.cachedKey = scryptSync(raw, "husk-vault-v1", 32);
    return this.cachedKey;
  }
}
