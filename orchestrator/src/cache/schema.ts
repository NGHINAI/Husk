import type { Database } from "better-sqlite3";

/**
 * Current schema version. Bump and add a migration block to applySchema
 * whenever a column changes.
 */
export const SCHEMA_VERSION = 2;

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
 *   - success_count  INTEGER           — M14: successful action outcomes per selector
 *   - failure_count  INTEGER           — M14: failed action outcomes per selector
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
      miss_count    INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_selectors_role_name
      ON selectors(role, name_norm);
  `);

  // M14 migration: add success_count / failure_count to existing DBs that were
  // created at schema version 1 (before these columns existed). ALTER TABLE
  // ADD COLUMN is safe to run on existing DBs — we swallow the "duplicate column
  // name" error that SQLite raises when the column is already present.
  for (const col of ["success_count INTEGER NOT NULL DEFAULT 0", "failure_count INTEGER NOT NULL DEFAULT 0"]) {
    try {
      db.exec(`ALTER TABLE selectors ADD COLUMN ${col}`);
    } catch {
      // Column already exists — safe to ignore.
    }
  }

  // Record / verify schema version
  const existing = db
    .prepare("SELECT value FROM schema_meta WHERE key = 'version'")
    .get() as { value: string } | undefined;
  if (!existing) {
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('version', ?)").run(
      String(SCHEMA_VERSION)
    );
  } else if (Number(existing.value) < SCHEMA_VERSION) {
    db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'version'").run(
      String(SCHEMA_VERSION)
    );
  }
}
