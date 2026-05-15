import type { Snapshot } from "../snapshot/types.js";
import type { Candidate, RejectionEnvelope, RejectionReason, Verb } from "./types.js";

export interface BuildRejectionArgs {
  reason: RejectionReason;
  verb: Verb;
  stable_id_attempted: string | null;
  snapshot: Snapshot;
  candidates: Candidate[];
  message?: string;
}

/**
 * Assemble a `RejectionEnvelope`. The HTTP layer is responsible for stripping
 * the `_resolver` side-channel from `snapshot_at_attempt` before serialising.
 */
export function buildRejection(args: BuildRejectionArgs): RejectionEnvelope {
  const env: RejectionEnvelope = {
    ok: false,
    reason: args.reason,
    verb: args.verb,
    stable_id_attempted: args.stable_id_attempted,
    candidates: args.candidates,
    snapshot_at_attempt: args.snapshot,
  };
  if (args.message) env.message = args.message;
  return env;
}
