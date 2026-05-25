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

  /**
   * Shared database for cognition tables (state graphs, transitions,
   * observations, exploration locks). Lives at `{cacheDir}/_cognition.db`.
   * Initialized on construction — all 4 M18 tables are created here so
   * downstream consumers (CognitionStorage, T3-T6) can access them via
   * `cache.db` without needing a domain.
   */
  readonly db: Database.Database;

  constructor(config: SiteGraphConfig) {
    this.cacheDir = config.cacheDir;
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
    // Open the shared cognition DB immediately; applySchema creates all tables.
    this.db = new Database(join(this.cacheDir, "_cognition.db"));
    applySchema(this.db);
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
          current_xpath: null,
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

  /**
   * Record a successful action outcome for a selector.
   * Increments `success_count` and updates `last_seen_at`. If no row exists
   * for the (domain, stable_id) pair, a minimal row is inserted.
   */
  recordSuccess(domain: string, stable_id: string): void {
    if (this.closed) throw new Error("SiteGraphCache: closed");
    if (!isValidDomain(domain)) return;
    const db = this.dbFor(domain);
    const now = Date.now();
    const updated = db
      .prepare(
        `UPDATE selectors SET success_count = success_count + 1, last_seen_at = ?
         WHERE stable_id = ?`
      )
      .run(now, stable_id);
    if (updated.changes === 0) {
      db.prepare(
        `INSERT OR IGNORE INTO selectors
           (stable_id, role, name_norm, last_seen_at, success_count)
         VALUES (?, '', '', ?, 1)`
      ).run(stable_id, now);
    }
  }

  /**
   * Record a failed action outcome for a selector.
   * Increments `failure_count`. If no row exists, a minimal row is inserted.
   */
  recordFailure(domain: string, stable_id: string): void {
    if (this.closed) throw new Error("SiteGraphCache: closed");
    if (!isValidDomain(domain)) return;
    const db = this.dbFor(domain);
    const now = Date.now();
    const updated = db
      .prepare(
        `UPDATE selectors SET failure_count = failure_count + 1
         WHERE stable_id = ?`
      )
      .run(stable_id);
    if (updated.changes === 0) {
      db.prepare(
        `INSERT OR IGNORE INTO selectors
           (stable_id, role, name_norm, last_seen_at, failure_count)
         VALUES (?, '', '', ?, 1)`
      ).run(stable_id, now);
    }
  }

  /**
   * Return the historical reliability of a selector as a value in [0, 1].
   *
   * reliability = success_count / (success_count + failure_count)
   *
   * Returns 0.5 (neutral prior) when the selector has never been seen or when
   * there is no outcome data (success_count + failure_count == 0).
   *
   * Reliability is scoped per-domain so the same stable_id on two different
   * sites never influences each other.
   */
  reliability(domain: string, stable_id: string): number {
    if (this.closed) throw new Error("SiteGraphCache: closed");
    if (!isValidDomain(domain)) return 0.5;

    const dbPath = join(this.cacheDir, `${domain}.db`);
    if (!existsSync(dbPath) && !this.connections.has(domain)) return 0.5;

    const db = this.dbFor(domain);
    const row = db
      .prepare(
        `SELECT success_count, failure_count FROM selectors WHERE stable_id = ?`
      )
      .get(stable_id) as { success_count: number; failure_count: number } | undefined;

    if (!row) return 0.5;
    const total = row.success_count + row.failure_count;
    if (total === 0) return 0.5;
    return row.success_count / total;
  }

  /** Close all open per-domain databases and the shared cognition DB. Idempotent. */
  close(): void {
    if (this.closed) return;
    for (const db of this.connections.values()) {
      db.close();
    }
    this.connections.clear();
    this.db.close();
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
