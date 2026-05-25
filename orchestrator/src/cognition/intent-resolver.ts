import type { IntentRef } from "./intention-types.js";
import { runFind } from "../session/find.js";
import type { FindContext, FindCandidate } from "../session/find.js";

/** Convert IntentRef into a single intent string for find.ts. */
export function intentRefToString(ref: IntentRef): string {
  if ("button" in ref) return `${ref.button} button`;
  if ("link" in ref) return `${ref.link} link`;
  if ("textbox" in ref) return `${ref.textbox} textbox`;
  if ("combobox" in ref) return `${ref.combobox} combobox`;
  if ("heading" in ref) return `${ref.heading} heading`;
  if ("role" in ref) return `${ref.name} ${ref.role}`;
  throw new Error(`Unknown IntentRef shape: ${JSON.stringify(ref)}`);
}

export interface IntentResolveResult {
  stable_id: string | null;
  candidates: FindCandidate[];
  /** Best-match score 0..1, undefined when no candidates. */
  score?: number;
}

/**
 * Resolve an IntentRef against a snapshot's AX nodes.
 * Returns the best-scoring stable_id, the candidate list, and the score.
 */
export async function resolveIntentRef(ref: IntentRef, ctx: FindContext): Promise<IntentResolveResult> {
  const intent = intentRefToString(ref);
  const result = await runFind(ctx, { intent });
  if (!result.ok || result.candidates.length === 0) {
    return { stable_id: null, candidates: [] };
  }
  const best = result.candidates[0];
  return { stable_id: best.stable_id, candidates: result.candidates, score: best.score };
}
