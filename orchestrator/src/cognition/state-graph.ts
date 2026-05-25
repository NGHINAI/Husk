/**
 * StateGraph — in-memory state machine for Husk v0.1 Phase A (M18 Task 3).
 *
 * Wraps a site's states (Map<StateId, SiteState>) and transitions (Transition[]).
 * Provides:
 *   - identifyCurrentState  — predicate-based state identification (highest-confidence)
 *   - findPath              — BFS shortest-path transition sequence from → to
 *   - affordancesIn         — list intentions valid in a state
 *   - upsertState           — idempotent state insert/replace
 *   - upsertTransition      — idempotent transition insert/replace (keyed by from+to)
 *   - toJSON / fromJSON     — lossless serialization roundtrip
 *
 * No IO, no SQLite — pure in-memory. Storage layer (T4) builds on top.
 */

import type { SiteState, Transition, StateId } from "./types.js";
import { evaluate, type SnapshotForPredicate } from "./predicate.js";

export class StateGraph {
  constructor(
    public readonly site: string,
    private states: Map<StateId, SiteState>,
    private transitions: Transition[],
  ) {}

  // ---------------------------------------------------------------------------
  // identifyCurrentState
  // ---------------------------------------------------------------------------

  /**
   * Find the state whose identify_by predicate matches the given snapshot.
   * When multiple states match, returns the one with the highest confidence score.
   * Returns null when nothing matches.
   */
  identifyCurrentState(snapshot: SnapshotForPredicate): { state: SiteState; confidence: number } | null {
    const matches: Array<{ state: SiteState; confidence: number }> = [];

    for (const s of this.states.values()) {
      if (evaluate(s.identify_by, snapshot)) {
        matches.push({ state: s, confidence: s.confidence });
      }
    }

    if (matches.length === 0) return null;

    // Sort descending by confidence; pick the best
    matches.sort((a, b) => b.confidence - a.confidence);
    return matches[0];
  }

  // ---------------------------------------------------------------------------
  // findPath — BFS
  // ---------------------------------------------------------------------------

  /**
   * BFS over transitions to find the shortest action-sequence path from `from`
   * to `to`.
   *
   * Returns:
   *   []         — from === to (already at target, no actions needed)
   *   Transition[] — ordered list of transitions to execute (length >= 1)
   *   null       — no path exists, or either state_id is unknown
   */
  findPath(from: StateId, to: StateId): Transition[] | null {
    // Already at target
    if (from === to) return [];

    // Unknown states — cannot plan a path
    if (!this.states.has(from) || !this.states.has(to)) return null;

    // BFS
    const queue: Array<{ state: StateId; path: Transition[] }> = [
      { state: from, path: [] },
    ];
    const visited = new Set<StateId>([from]);

    while (queue.length > 0) {
      const { state, path } = queue.shift()!;

      const outgoing = this.transitions.filter((t) => t.from_state === state);

      for (const t of outgoing) {
        if (t.to_state === to) {
          // Found the target — return the path including this transition
          return [...path, t];
        }

        if (!visited.has(t.to_state)) {
          visited.add(t.to_state);
          queue.push({ state: t.to_state, path: [...path, t] });
        }
      }
    }

    // No path found
    return null;
  }

  // ---------------------------------------------------------------------------
  // affordancesIn
  // ---------------------------------------------------------------------------

  /**
   * Return the list of intention names available in the given state.
   * Returns [] for unknown states.
   */
  affordancesIn(state_id: StateId): string[] {
    return this.states.get(state_id)?.affordances ?? [];
  }

  // ---------------------------------------------------------------------------
  // Mutators
  // ---------------------------------------------------------------------------

  /** Add or replace a state (keyed by state_id). Idempotent. */
  upsertState(s: SiteState): void {
    this.states.set(s.state_id, s);
  }

  /**
   * Add or replace a transition (keyed by from_state + to_state pair). Idempotent.
   * Only one transition per (from, to) pair is retained.
   */
  upsertTransition(t: Transition): void {
    const idx = this.transitions.findIndex(
      (x) => x.from_state === t.from_state && x.to_state === t.to_state,
    );
    if (idx >= 0) {
      this.transitions[idx] = t;
    } else {
      this.transitions.push(t);
    }
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /** Serialize to a plain JSON-safe object. Lossless. */
  toJSON(): { site: string; states: SiteState[]; transitions: Transition[] } {
    return {
      site: this.site,
      states: [...this.states.values()],
      transitions: [...this.transitions],
    };
  }

  /** Hydrate a StateGraph from the output of toJSON(). */
  static fromJSON(data: {
    site: string;
    states: SiteState[];
    transitions: Transition[];
  }): StateGraph {
    const states = new Map<StateId, SiteState>();
    for (const s of data.states) {
      states.set(s.state_id, s);
    }
    return new StateGraph(data.site, states, [...data.transitions]);
  }

  // ---------------------------------------------------------------------------
  // Introspection helpers (used by tests and storage layer)
  // ---------------------------------------------------------------------------

  /** Return a snapshot of all states. */
  listStates(): SiteState[] {
    return [...this.states.values()];
  }

  /** Return a snapshot of all transitions. */
  listTransitions(): Transition[] {
    return [...this.transitions];
  }
}
