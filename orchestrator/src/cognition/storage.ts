/**
 * CognitionStorage — SQLite CRUD for site states, transitions, observations,
 * and per-site exploration locks. Built on the shared `_cognition.db`
 * instance exposed by SiteGraphCache (M18 Task 1).
 *
 * All writes are idempotent (ON CONFLICT DO UPDATE). Exploration locks
 * support TTL-based expiry — expired locks are cleaned up lazily on the
 * next acquire/isLocked call.
 */

import type { SiteGraphCache } from "../cache/site-graph.js";
import type { SiteState, Transition, Observation, StateId } from "./types.js";
import { StateGraph } from "./state-graph.js";

export class CognitionStorage {
  private db: any; // better-sqlite3 Database

  constructor(cache: SiteGraphCache) {
    this.db = (cache as unknown as { db: unknown }).db;
    if (!this.db) {
      throw new Error(
        "CognitionStorage requires SiteGraphCache with .db property",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------

  upsertState(s: SiteState): void {
    this.db
      .prepare(
        `INSERT INTO cognition_states
           (site, state_id, identify_by, affordances, observed_count, confidence, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(site, state_id) DO UPDATE SET
           identify_by    = excluded.identify_by,
           affordances    = excluded.affordances,
           observed_count = excluded.observed_count,
           confidence     = excluded.confidence,
           last_seen_at   = excluded.last_seen_at`,
      )
      .run(
        s.site,
        s.state_id,
        JSON.stringify(s.identify_by),
        JSON.stringify(s.affordances),
        s.observed_count,
        s.confidence,
        s.last_seen_at,
      );
  }

  getState(site: string, state_id: StateId): SiteState | null {
    const row = this.db
      .prepare(
        `SELECT * FROM cognition_states WHERE site = ? AND state_id = ?`,
      )
      .get(site, state_id);
    if (!row) return null;
    return this.rowToState(row);
  }

  listStates(site: string): SiteState[] {
    return this.db
      .prepare(
        `SELECT * FROM cognition_states WHERE site = ? ORDER BY state_id`,
      )
      .all(site)
      .map((r: any) => this.rowToState(r));
  }

  private rowToState(row: any): SiteState {
    return {
      site: row.site,
      state_id: row.state_id,
      identify_by: JSON.parse(row.identify_by),
      affordances: JSON.parse(row.affordances),
      observed_count: row.observed_count,
      confidence: row.confidence,
      last_seen_at: row.last_seen_at,
    };
  }

  // ---------------------------------------------------------------------------
  // Transitions
  // ---------------------------------------------------------------------------

  upsertTransition(t: Transition): void {
    this.db
      .prepare(
        `INSERT INTO cognition_transitions
           (site, from_state, to_state, action_sequence, success_count,
            failure_count, avg_duration_ms, confidence, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(site, from_state, to_state) DO UPDATE SET
           action_sequence = excluded.action_sequence,
           success_count   = excluded.success_count,
           failure_count   = excluded.failure_count,
           avg_duration_ms = excluded.avg_duration_ms,
           confidence      = excluded.confidence,
           last_used_at    = excluded.last_used_at`,
      )
      .run(
        t.site,
        t.from_state,
        t.to_state,
        JSON.stringify(t.action_sequence),
        t.success_count,
        t.failure_count,
        t.avg_duration_ms,
        t.confidence,
        t.last_used_at,
      );
  }

  getTransitions(site: string, from?: StateId): Transition[] {
    const rows = from
      ? this.db
          .prepare(
            `SELECT * FROM cognition_transitions WHERE site = ? AND from_state = ?`,
          )
          .all(site, from)
      : this.db
          .prepare(`SELECT * FROM cognition_transitions WHERE site = ?`)
          .all(site);
    return rows.map((r: any) => this.rowToTransition(r));
  }

  private rowToTransition(row: any): Transition {
    return {
      site: row.site,
      from_state: row.from_state,
      to_state: row.to_state,
      action_sequence: JSON.parse(row.action_sequence),
      success_count: row.success_count,
      failure_count: row.failure_count,
      avg_duration_ms: row.avg_duration_ms,
      confidence: row.confidence,
      last_used_at: row.last_used_at,
    };
  }

  // ---------------------------------------------------------------------------
  // Observations
  // ---------------------------------------------------------------------------

  recordObservation(o: Observation): void {
    this.db
      .prepare(
        `INSERT INTO cognition_observations
           (site, ts, prev_state, current_state, url, snapshot_summary, action_taken,
            intention_name, evidence_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        o.site,
        o.ts,
        o.prev_state,
        o.current_state,
        o.url,
        o.snapshot_summary,
        o.action_taken ? JSON.stringify(o.action_taken) : null,
        o.intention_name ?? null,
        o.evidence ? JSON.stringify(o.evidence) : null,
      );
  }

  recentObservations(site: string, since_ts: number): Observation[] {
    return this.db
      .prepare(
        `SELECT * FROM cognition_observations
         WHERE site = ? AND ts >= ?
         ORDER BY ts ASC`,
      )
      .all(site, since_ts)
      .map((r: any) => {
        let evidence: import("./intention-types.js").Evidence[] | undefined;
        if (r.evidence_json) {
          try {
            evidence = JSON.parse(r.evidence_json) as import("./intention-types.js").Evidence[];
          } catch {
            evidence = [];
          }
        }
        return {
          site: r.site,
          ts: r.ts,
          prev_state: r.prev_state,
          current_state: r.current_state,
          url: r.url,
          snapshot_summary: r.snapshot_summary,
          action_taken: r.action_taken ? JSON.parse(r.action_taken) : null,
          intention_name: r.intention_name ?? undefined,
          evidence,
        } satisfies Observation;
      });
  }

  // ---------------------------------------------------------------------------
  // Composite: load a hydrated StateGraph
  // ---------------------------------------------------------------------------

  loadStateGraph(site: string): StateGraph {
    const states = new Map<StateId, SiteState>();
    for (const s of this.listStates(site)) {
      states.set(s.state_id, s);
    }
    return new StateGraph(site, states, this.getTransitions(site));
  }

  // ---------------------------------------------------------------------------
  // Exploration lock — per-site, with TTL
  //
  // Semantics:
  //   - First agent to call acquireExplorationLock wins; returns true.
  //   - A second agent gets false while the lock is active.
  //   - Same holder may re-acquire (refreshes TTL); returns true.
  //   - releaseExplorationLock is a no-op if called by a non-holder.
  //   - Expired locks are cleaned up lazily on next acquire / isLocked call.
  //   - Default TTL: 5 minutes (300_000 ms).
  // ---------------------------------------------------------------------------

  acquireExplorationLock(
    site: string,
    holder_id: string,
    ttl_ms: number = 300_000,
  ): boolean {
    const now = Date.now();
    const expires_at = now + ttl_ms;

    const existing = this.db
      .prepare(
        `SELECT holder_id, expires_at FROM cognition_exploration_locks WHERE site = ?`,
      )
      .get(site);

    if (existing) {
      if (existing.expires_at < now) {
        // Expired — clear it so we can insert fresh
        this.db
          .prepare(
            `DELETE FROM cognition_exploration_locks WHERE site = ?`,
          )
          .run(site);
      } else if (existing.holder_id === holder_id) {
        // Same holder — refresh TTL
        this.db
          .prepare(
            `UPDATE cognition_exploration_locks
             SET expires_at = ?, acquired_at = ?
             WHERE site = ?`,
          )
          .run(expires_at, now, site);
        return true;
      } else {
        // Different holder, still valid — block
        return false;
      }
    }

    // Insert new lock
    this.db
      .prepare(
        `INSERT INTO cognition_exploration_locks
           (site, holder_id, acquired_at, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(site, holder_id, now, expires_at);
    return true;
  }

  releaseExplorationLock(site: string, holder_id: string): void {
    // No-op if the caller is not the current holder
    this.db
      .prepare(
        `DELETE FROM cognition_exploration_locks
         WHERE site = ? AND holder_id = ?`,
      )
      .run(site, holder_id);
  }

  isExplorationLocked(
    site: string,
  ): { holder_id: string; expires_at: number } | null {
    const row = this.db
      .prepare(
        `SELECT holder_id, expires_at FROM cognition_exploration_locks WHERE site = ?`,
      )
      .get(site);
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      // Expired — clean up lazily
      this.db
        .prepare(`DELETE FROM cognition_exploration_locks WHERE site = ?`)
        .run(site);
      return null;
    }
    return { holder_id: row.holder_id, expires_at: row.expires_at };
  }
}
