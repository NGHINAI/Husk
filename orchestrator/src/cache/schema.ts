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
