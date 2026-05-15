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
    // CRITICAL: different scrypt salt than VaultStore (husk-vault-v1) — domain
    // separation so a vault-key compromise doesn't trivially leak credentials.
    this.cachedKey = scryptSync(raw, "husk-credentials-v1", 32);
    return this.cachedKey;
  }
}
