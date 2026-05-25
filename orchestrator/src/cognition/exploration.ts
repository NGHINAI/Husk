/**
 * ExplorationHarness — M18 Task 6.
 *
 * Observes a session: every snapshot taken, every action result, every state
 * change. Records to the observations log and grows the per-site state graph
 * from observed data with no LLM in the loop.
 *
 * On each observe(snapshot, lastAction?):
 *  1. Load the state graph from storage and attempt to identify the current state.
 *  2. If matched — increment observed_count + update last_seen_at via upsertState.
 *  3. If no match — synthesize a new tentative state and write it.
 *  4. If there was a previous state AND a lastAction — upsert/update the transition.
 *  5. Append an Observation row.
 *  6. Track _previousStateId for next call.
 */

import type { ActionStep, SiteState, Transition } from "./types.js";
import type { SnapshotForPredicate, AxTreeNode } from "./predicate.js";
import type { CognitionStorage } from "./storage.js";
import { newTransitionConfidence, applySuccess } from "./confidence.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExplorationOptions {
  site: string;
  session_id: string;
  storage: CognitionStorage;
  /** Override clock for testing. Defaults to Date.now. */
  now?: () => number;
}

export class ExplorationHarness {
  private readonly site: string;
  private readonly storage: CognitionStorage;
  private readonly now: () => number;
  private _previousStateId: string | null = null;

  constructor(opts: ExplorationOptions) {
    this.site = opts.site;
    // session_id is part of the public API for future multi-session correlation;
    // it is accepted but not stored yet to avoid noUnusedLocals violations.
    void opts.session_id;
    this.storage = opts.storage;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Called after every navigation, action, etc.
   * The snapshot is the result of the action.
   */
  observe(snapshot: SnapshotForPredicate, lastAction?: ActionStep): void {
    const ts = this.now();

    // Step 1: Identify current state.
    const graph = this.storage.loadStateGraph(this.site);
    const match = graph.identifyCurrentState(snapshot);

    let currentStateId: string;

    if (match !== null) {
      // Step 2: Known state — increment observed_count and refresh last_seen_at.
      const existing = match.state;
      const updated: SiteState = {
        ...existing,
        observed_count: existing.observed_count + 1,
        last_seen_at: ts,
      };
      this.storage.upsertState(updated);
      currentStateId = existing.state_id;
    } else {
      // Step 3: New state — synthesize a tentative state.
      const stateId = synthesizeStateId(this.site, snapshot);
      const identifyBy = buildIdentifyBy(snapshot);
      const newState: SiteState = {
        site: this.site,
        state_id: stateId,
        identify_by: identifyBy,
        affordances: [],
        observed_count: 1,
        confidence: 0.5,
        last_seen_at: ts,
      };
      this.storage.upsertState(newState);
      currentStateId = stateId;
    }

    // Step 4: Record transition if there was a previous state and an action.
    if (this._previousStateId !== null && lastAction !== undefined) {
      const existingTransitions = this.storage.getTransitions(
        this.site,
        this._previousStateId,
      );
      const existing = existingTransitions.find(
        (t) => t.to_state === currentStateId,
      );

      if (existing !== undefined) {
        // Increment success_count and apply confidence boost.
        const updated: Transition = {
          ...existing,
          success_count: existing.success_count + 1,
          confidence: applySuccess(existing.confidence),
          last_used_at: ts,
        };
        this.storage.upsertTransition(updated);
      } else {
        // First time seeing this transition — create it.
        const newTransition: Transition = {
          site: this.site,
          from_state: this._previousStateId,
          to_state: currentStateId,
          action_sequence: [lastAction],
          success_count: 1,
          failure_count: 0,
          avg_duration_ms: 0,
          confidence: newTransitionConfidence(),
          last_used_at: ts,
        };
        this.storage.upsertTransition(newTransition);
      }
    }

    // Step 5: Append Observation.
    const snapshotSummary = JSON.stringify({
      url: snapshot.url,
      markers: mostDistinctiveAxNodes(snapshot.root, 2).map((n) => ({
        r: n.r,
        n: n.n,
      })),
    });
    this.storage.recordObservation({
      site: this.site,
      ts,
      prev_state: this._previousStateId,
      current_state: currentStateId,
      url: snapshot.url,
      snapshot_summary: snapshotSummary,
      action_taken: lastAction ?? null,
    });

    // Step 6: Track for next call.
    this._previousStateId = currentStateId;
  }

  /** Cleanup hook — no-op; lets the caller mark a session done. */
  finish(): void {
    // Intentionally a no-op for now.
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Escape all regex special characters in a literal string. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalize a URL for use in a state predicate:
 * - Lowercase the scheme + host
 * - Remove fragment (#...)
 * - Remove trailing slash from the path (unless it's the root "/")
 * - Preserve search params
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Lowercase scheme + host (already normalized by URL constructor).
    parsed.hash = ""; // strip fragment
    let path = parsed.pathname;
    // Remove trailing slash unless it's just "/"
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    parsed.pathname = path;
    return parsed.toString();
  } catch {
    // Fallback for relative or malformed URLs: just strip fragment.
    const fragIdx = url.indexOf("#");
    const withoutFrag = fragIdx >= 0 ? url.slice(0, fragIdx) : url;
    // Remove trailing slash unless root
    return withoutFrag.length > 1 && withoutFrag.endsWith("/")
      ? withoutFrag.slice(0, -1)
      : withoutFrag;
  }
}

/** Roles considered "distinctive" for AX node selection. */
const DISTINCTIVE_ROLES = new Set([
  "heading",
  "button",
  "link",
  "textbox",
  "searchbox",
  "tab",
  "menuitem",
]);

/**
 * Walk the AX tree and pick the top-K most distinctive nodes.
 *
 * Heuristic:
 *  - Only include nodes with a non-empty `n` (name) AND a role in DISTINCTIVE_ROLES.
 *  - Prefer shallower nodes (depth 0 > depth 1 > …).
 *  - Tie-break: longer name first (more specific), then alphabetical.
 *
 * Returns [] if root is missing or tree has no qualifying nodes.
 */
export function mostDistinctiveAxNodes(
  root: AxTreeNode | null | undefined,
  k: number,
): Array<{ r: string; n: string }> {
  if (!root) return [];

  interface Candidate {
    r: string;
    n: string;
    depth: number;
  }

  const candidates: Candidate[] = [];

  // Iterative BFS to track depth.
  const queue: Array<{ node: AxTreeNode; depth: number }> = [
    { node: root, depth: 0 },
  ];
  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    if (node.n && DISTINCTIVE_ROLES.has(node.r.toLowerCase())) {
      candidates.push({ r: node.r, n: node.n, depth });
    }
    for (const child of node.c ?? []) {
      queue.push({ node: child, depth: depth + 1 });
    }
  }

  // Sort: shallower first, then longer name first, then alphabetical.
  candidates.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (b.n.length !== a.n.length) return b.n.length - a.n.length;
    return a.n.localeCompare(b.n);
  });

  return candidates.slice(0, k).map(({ r, n }) => ({ r, n }));
}

/**
 * Compute a stable signature for a transition's action sequence.
 * Used for dedup checks.
 */
export function signatureOf(action_sequence: ActionStep[]): string {
  return JSON.stringify(action_sequence);
}

// ---------------------------------------------------------------------------
// State synthesis helpers
// ---------------------------------------------------------------------------

/**
 * Build an "and" predicate combining a URL pattern and up to 2 distinctive
 * AX nodes from the snapshot.
 */
function buildIdentifyBy(snapshot: SnapshotForPredicate): import("./types.js").Predicate {
  const urlPredicate: import("./types.js").Predicate = {
    type: "url_pattern",
    regex: escapeRegex(normalizeUrl(snapshot.url)),
  };

  const axMarkers = mostDistinctiveAxNodes(snapshot.root, 2).map(
    (node): import("./types.js").Predicate => ({
      type: "ax_role_name",
      role: node.r,
      name: node.n,
    }),
  );

  return {
    type: "and",
    all: [urlPredicate, ...axMarkers],
  };
}

/**
 * Generate a synthetic state ID for a new state derived from a snapshot.
 * Format: "<site>::<slug>" where slug is derived from the URL path.
 */
function synthesizeStateId(
  site: string,
  snapshot: SnapshotForPredicate,
): string {
  let slug: string;
  try {
    const parsed = new URL(snapshot.url);
    // Turn the path into a slug: strip leading slash, replace non-word chars.
    slug = parsed.pathname
      .replace(/^\/+/, "")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/_+$/, "")
      .toLowerCase();
    if (!slug) slug = "root";
  } catch {
    slug = "unknown";
  }
  // Add a short timestamp suffix to avoid collisions between different pages
  // that happen to have the same path shape (e.g., /login on two different sites).
  const suffix = Date.now().toString(36).slice(-4);
  return `${site}::${slug}_${suffix}`;
}
