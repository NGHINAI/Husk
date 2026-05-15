import type { Snapshot } from "../snapshot/types.js";
import type { SiteGraphCache } from "../cache/site-graph.js";
import { runPreActionSanity, runPostActionAssertions, type SanityResult } from "./sanity.js";
import { buildRejection } from "./envelope.js";
import { findCandidates } from "./candidates.js";
import { normalizeDomain } from "../cache/domain.js";
import type {
  PolicyDocument,
  RejectionEnvelope,
  Verb,
  Warning,
} from "./types.js";

export type WatchdogPreResult =
  | { ok: true; backendNodeId: number | null }
  | { ok: false; envelope: RejectionEnvelope };

export interface WatchdogOptions {
  /** Used by `findCandidates` when a rejection needs alternative selectors. */
  cache?: SiteGraphCache | null;
}

/**
 * Composes Layer 1 (sanity) and Layer 2 (policy — wired in T11).
 * One instance per Session. Stateless aside from its policy.
 */
export class Watchdog {
  private policy: PolicyDocument | null = null;

  constructor(private readonly opts: WatchdogOptions = {}) {}

  setPolicy(policy: PolicyDocument | null): void {
    this.policy = policy;
  }

  getPolicy(): PolicyDocument | null {
    return this.policy;
  }

  /**
   * Pre-action gate. Returns either `ok: true` with the resolved backendNodeId
   * (or `null` for press_key / window scroll) or a fully-built rejection envelope.
   * Layer 2 policy hooks are inserted by T11.
   */
  evaluatePre(snapshot: Snapshot, verb: Verb, stableId: string | null): WatchdogPreResult {
    const sanity = runPreActionSanity(snapshot, verb, stableId);
    if (!sanity.ok) {
      return { ok: false, envelope: this.buildEnvelope(snapshot, verb, stableId, sanity) };
    }
    let backendNodeId: number | null = null;
    if (stableId && snapshot._resolver) {
      backendNodeId = snapshot._resolver.get(stableId) ?? null;
    }
    return { ok: true, backendNodeId };
  }

  /**
   * Post-action assertions. Always non-blocking; returns a (possibly empty)
   * list of warnings the caller surfaces alongside `ok: true`.
   */
  evaluatePost(args: {
    verb: Verb;
    before: Snapshot;
    after: Snapshot;
    urlBefore: string;
    urlAfter: string;
  }): Warning[] {
    return runPostActionAssertions(args);
  }

  private buildEnvelope(
    snapshot: Snapshot,
    verb: Verb,
    stableId: string | null,
    sanity: Extract<SanityResult, { ok: false }>
  ): RejectionEnvelope {
    const candidates = this.opts.cache && sanity.node
      ? findCandidates(this.opts.cache, normalizeDomain(snapshot.url), verb, sanity.node.n)
      : this.opts.cache && stableId
      ? findCandidates(this.opts.cache, normalizeDomain(snapshot.url), verb, stableId.split(":")[0])
      : [];
    return buildRejection({
      reason: sanity.reason,
      verb,
      stable_id_attempted: stableId,
      snapshot,
      candidates,
    });
  }
}
