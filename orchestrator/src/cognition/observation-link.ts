/**
 * observation-link.ts — M21 Phase D Task 4.
 *
 * Bridges IntentionCompiler outcomes back into the cognition_observations log.
 * Called at the end of every execute() call (success or failure) when storage
 * is wired in via CompilerOptions.storage.
 */

import type { CognitionStorage } from "./storage.js";
import type { Outcome } from "./intention-types.js";

/**
 * Write a per-intention observation log entry.
 * Called by IntentionCompiler at the end of execute() (success or failure).
 *
 * Errors here MUST NOT propagate — observation logging is a side-effect and
 * must never break the intention itself. Callers must wrap in try/catch.
 */
export function linkOutcomeToObservation(
  storage: CognitionStorage,
  site: string,
  url: string,
  outcome: Outcome,
): void {
  storage.recordObservation({
    site,
    ts: Date.now(),
    prev_state: outcome.state_before ?? null,
    current_state: outcome.state_after ?? outcome.state_before ?? "unknown",
    url,
    snapshot_summary: JSON.stringify({
      intention: outcome.intention,
      ok: outcome.ok,
      reason: outcome.reason,
    }),
    action_taken: null,
    intention_name: outcome.intention,
    evidence: outcome.evidence,
  });
}
