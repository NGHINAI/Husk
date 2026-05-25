import type { Database } from "better-sqlite3";

/**
 * Current schema version. Bump and add a migration block to applySchema
 * whenever a column changes.
 */
export const SCHEMA_VERSION = 5;

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

  // M18 / schema version 3: cognition tables for v0.1 state graphs.
  // CREATE TABLE IF NOT EXISTS is idempotent — safe on existing DBs.
  db.exec(`
    -- Per-site states (the AX-fingerprint of a page)
    CREATE TABLE IF NOT EXISTS cognition_states (
      site          TEXT NOT NULL,
      state_id      TEXT NOT NULL,
      identify_by   TEXT NOT NULL,
      affordances   TEXT NOT NULL,
      observed_count INTEGER NOT NULL DEFAULT 0,
      confidence    REAL NOT NULL DEFAULT 0.5,
      last_seen_at  INTEGER NOT NULL,
      PRIMARY KEY (site, state_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cognition_states_site
      ON cognition_states(site);

    -- Per-site transitions (state → action → state)
    CREATE TABLE IF NOT EXISTS cognition_transitions (
      site            TEXT NOT NULL,
      from_state      TEXT NOT NULL,
      to_state        TEXT NOT NULL,
      action_sequence TEXT NOT NULL,
      success_count   INTEGER NOT NULL DEFAULT 0,
      failure_count   INTEGER NOT NULL DEFAULT 0,
      avg_duration_ms REAL NOT NULL DEFAULT 0,
      confidence      REAL NOT NULL DEFAULT 0.5,
      last_used_at    INTEGER NOT NULL,
      PRIMARY KEY (site, from_state, to_state)
    );
    CREATE INDEX IF NOT EXISTS idx_cognition_transitions_site
      ON cognition_transitions(site);
    CREATE INDEX IF NOT EXISTS idx_cognition_transitions_from
      ON cognition_transitions(site, from_state);

    -- Observation log (chronological record of state changes)
    CREATE TABLE IF NOT EXISTS cognition_observations (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      site             TEXT NOT NULL,
      ts               INTEGER NOT NULL,
      prev_state       TEXT,
      current_state    TEXT NOT NULL,
      url              TEXT NOT NULL,
      snapshot_summary TEXT,
      action_taken     TEXT,
      intention_name   TEXT,
      evidence_json    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cognition_observations_site_ts
      ON cognition_observations(site, ts);

    -- Per-site exploration lock (concurrent agent coordination)
    CREATE TABLE IF NOT EXISTS cognition_exploration_locks (
      site        TEXT PRIMARY KEY,
      holder_id   TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    );
  `);

  // M19 / schema version 4: cognition_intentions table for intention compiler.
  // CREATE TABLE IF NOT EXISTS is idempotent — safe on existing DBs.
  db.exec(`
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
  `);

  // M21 / schema version 5: add intention_name + evidence_json to cognition_observations.
  // ALTER TABLE ADD COLUMN is safe on existing DBs — wrap in try/catch to handle
  // "duplicate column name" errors when columns already exist (idempotent migration).
  for (const colDef of ["intention_name TEXT", "evidence_json TEXT"]) {
    try {
      db.exec(`ALTER TABLE cognition_observations ADD COLUMN ${colDef}`);
    } catch {
      // Column already exists — safe to ignore.
    }
  }

  // Record / verify schema version in schema_meta table
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

  // Also keep PRAGMA user_version in sync — some tooling (and tests) read it directly.
  const currentPragmaVersion = (db.pragma("user_version") as Array<{ user_version: number }>)[0]
    ?.user_version ?? 0;
  if (currentPragmaVersion < SCHEMA_VERSION) {
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
}
