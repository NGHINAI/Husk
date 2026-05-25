/**
 * IntentionCompiler — M19 Phase B Task 7.
 *
 * IntentionCompiler.execute(session, intention, args) → Outcome
 *
 * Orchestrates:
 *   1. Identify current state via StateGraph.identifyCurrentState
 *   2. BFS path to requires_state (if set) via StateGraph.findPath
 *   3. Execute each transition's action_sequence (ActionStep[])
 *   4. Re-snapshot + verify post-state after each transition (detect drift)
 *   5. Execute intention.steps (IntentionStep[])
 *   6. Run verify checks → collect Evidence
 *   7. Match failure_modes (even on apparent success)
 *   8. Classify thrown errors via failure-taxonomy
 *   9. Return Outcome — never throws
 */

import type {
  Intention,
  IntentionStep,
  Outcome,
  Evidence,
  TransitionLog,
  FailureReason,
  IntentRef,
} from "./intention-types.js";
import type { ActionStep } from "./types.js";
import type { StateGraph } from "./state-graph.js";
import type { SnapshotForPredicate, AxTreeNode } from "./predicate.js";
import type { VerifyContext, NetworkEntry } from "./verify-runner.js";
import { runAllVerify, runVerify, runVerifyWithRetry, runAllVerifyWithRetry } from "./verify-runner.js";
import { resolveIntentRef } from "./intent-resolver.js";
import type { FindContext } from "../session/find.js";
import { classifyError, recoveryStrategy } from "./failure-taxonomy.js";
import { interpolate } from "./intention-yaml.js";
import type { CognitionStorage } from "./storage.js";
import { linkOutcomeToObservation } from "./observation-link.js";

// ---------------------------------------------------------------------------
// SessionAdapter — minimal interface the compiler needs.
// Real Session implements this (additive — T8 wires them up).
// ---------------------------------------------------------------------------

export interface SessionAdapter {
  currentUrl(): string;
  /** Returns Husk snapshot envelope (opaque shape; compiler reads .root / .url). */
  snapshot(): Promise<unknown>;
  click(stable_id: string): Promise<void>;
  type(stable_id: string, text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  scroll(args: { stable_id?: string; direction: "up" | "down" | "into_view"; amount_px?: number }): Promise<void>;
  navigate(url: string): Promise<void>;
  recentNetwork(): NetworkEntry[];
}

export interface CompilerOptions {
  graph: StateGraph;
  site: string;
  /** When set, outcomes get logged to cognition_observations (Phase D). */
  storage?: CognitionStorage;
  /** Optional clock override for testing. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// IntentionCompiler
// ---------------------------------------------------------------------------

export class IntentionCompiler {
  private readonly graph: StateGraph;
  // site is retained for future use (T8 Session.intend wires it in)
  readonly site: string;
  private readonly now: () => number;
  private readonly storage: CognitionStorage | undefined;

  constructor(opts: CompilerOptions) {
    this.graph = opts.graph;
    this.site = opts.site;
    this.now = opts.now ?? (() => Date.now());
    this.storage = opts.storage;
  }

  async execute<T = unknown>(
    session: SessionAdapter,
    intention: Intention,
    args: Record<string, unknown>,
  ): Promise<Outcome<T>> {
    const t0 = this.now();
    const steps_observed: TransitionLog[] = [];
    let state_before: string | null = null;

    try {
      // Step 1: identify current state.
      const snap0 = await session.snapshot();
      const url0 = session.currentUrl();
      const adapted0 = this.adapt(snap0, url0);
      const cur = this.graph.identifyCurrentState(adapted0);
      state_before = cur?.state.state_id ?? null;

      // Step 2: if requires_state, plan + traverse.
      if (intention.requires_state) {
        const target = interpolate(intention.requires_state, args);

        if (!state_before) {
          return this.finishOutcome(this.failOutcome(
            intention, args, null, undefined,
            "unknown_state",
            "no current state matched",
            [], steps_observed, t0,
          ), session);
        }

        if (state_before !== target) {
          const path = this.graph.findPath(state_before, target);
          if (!path) {
            return this.finishOutcome(this.failOutcome(
              intention, args, state_before, undefined,
              "no_path_to_target",
              `no path from ${state_before} to ${target}`,
              [], steps_observed, t0,
            ), session);
          }

          for (const transition of path) {
            const tStart = this.now();

            for (const action of transition.action_sequence) {
              await this.dispatchAction(session, action, args);
            }

            const postSnap = await session.snapshot();
            const postAdapted = this.adapt(postSnap, session.currentUrl());
            const postState = this.graph.identifyCurrentState(postAdapted);
            const arrived = postState?.state.state_id === transition.to_state;

            steps_observed.push({
              from_state: transition.from_state,
              to_state: transition.to_state,
              actions: transition.action_sequence,
              duration_ms: this.now() - tStart,
              ok: arrived,
            });

            if (!arrived) {
              return this.finishOutcome(this.failOutcome(
                intention, args, state_before,
                postState?.state.state_id,
                "state_drift_mid_execution",
                `expected ${transition.to_state}, saw ${postState?.state.state_id ?? "unknown"}`,
                [], steps_observed, t0,
              ), session);
            }
          }
        }
      }

      // Step 3: execute intention.steps.
      let snap = await session.snapshot();
      let url = session.currentUrl();

      for (const step of intention.steps) {
        await this.dispatchStep(session, step, args, snap);
        snap = await session.snapshot();
        url = session.currentUrl();
      }

      // Step 4: build verify context factory. The factory re-snapshots each call
      // so polling paths always see the latest browser state.
      const verifyCtxFactory = async (): Promise<VerifyContext> => {
        const fresh = await session.snapshot();
        const freshUrl = session.currentUrl();
        return {
          currentUrl: freshUrl,
          snapshot: this.adapt(fresh, freshUrl),
          network: session.recentNetwork(),
        };
      };

      // Determine if any check wants retry polling (verify OR failure_modes).
      const hasRetryOnVerify = intention.verify.some((c) => c.retry !== undefined);
      const hasRetryOnFailureModes = intention.failure_modes.some((fm) => fm.match.retry !== undefined);
      const anyRetry = hasRetryOnVerify || hasRetryOnFailureModes;

      // For the single-shot path: capture ONE context from the last snap (no extra snapshot call).
      // For the retry path: use the factory (may snapshot many times).
      const ctxSingleShot: VerifyContext | null = anyRetry
        ? null
        : {
            currentUrl: url,
            snapshot: this.adapt(snap, url),
            network: session.recentNetwork(),
          };

      // Step 5: check failure_mode patterns BEFORE verify — catches rate-limit soft failures.
      for (const fm of intention.failure_modes) {
        const ev = fm.match.retry
          ? await runVerifyWithRetry(fm.match, verifyCtxFactory)
          : runVerify(fm.match, ctxSingleShot!);
        if (ev.passed) {
          // Collect verify evidence for the failure Outcome (single-shot is fine here —
          // we already know we're failing; no need to re-poll verify).
          const fmVerifyCtx = ctxSingleShot ?? (await verifyCtxFactory());
          const evidence = runAllVerify(intention.verify, fmVerifyCtx);
          return this.finishOutcome(this.failOutcome(
            intention, args, state_before, undefined,
            fm.reason,
            `failure_mode matched: ${fm.match.description}`,
            evidence, steps_observed, t0,
          ), session);
        }
      }

      // Step 6: run verify checks.
      const evidence = hasRetryOnVerify
        ? await runAllVerifyWithRetry(intention.verify, verifyCtxFactory)
        : runAllVerify(intention.verify, ctxSingleShot!);
      const allPassed = evidence.every((e) => e.passed);

      if (!allPassed) {
        return this.finishOutcome(this.failOutcome(
          intention, args, state_before, undefined,
          "verify_failed",
          "one or more verify checks failed",
          evidence, steps_observed, t0,
        ), session);
      }

      // Step 7: identify final state.
      const finalState = this.graph.identifyCurrentState(this.adapt(snap, url));

      return this.finishOutcome({
        ok: true,
        intention: intention.name,
        args,
        state_before,
        state_after: finalState?.state.state_id,
        evidence,
        duration_ms: this.now() - t0,
        steps_observed,
      }, session);

    } catch (err) {
      const { reason, detail } = classifyError(err);
      return this.finishOutcome(this.failOutcome(
        intention, args, state_before, undefined,
        reason, detail,
        [], steps_observed, t0,
      ), session);
    }
  }

  // ---------------------------------------------------------------------------
  // dispatchStep — executes an IntentionStep (from intention.steps)
  // ---------------------------------------------------------------------------

  private async dispatchStep(
    session: SessionAdapter,
    step: IntentionStep,
    args: Record<string, unknown>,
    snapshot: unknown,
  ): Promise<void> {
    switch (step.verb) {
      case "click": {
        const ctx = this.findContext(snapshot);
        const r = await resolveIntentRef(step.target, ctx);
        if (!r.stable_id) throw new Error(`element_not_found: ${JSON.stringify(step.target)}`);
        await session.click(r.stable_id);
        return;
      }
      case "type": {
        const ctx = this.findContext(snapshot);
        const r = await resolveIntentRef(step.target, ctx);
        if (!r.stable_id) throw new Error(`element_not_found: ${JSON.stringify(step.target)}`);
        const value = interpolate(step.value, args);
        await session.type(r.stable_id, value);
        return;
      }
      case "press_key":
        await session.pressKey(step.key);
        return;
      case "scroll": {
        let stable_id: string | undefined;
        if (step.target) {
          const ctx = this.findContext(snapshot);
          const r = await resolveIntentRef(step.target, ctx);
          if (!r.stable_id) throw new Error(`element_not_found: ${JSON.stringify(step.target)}`);
          stable_id = r.stable_id;
        }
        await session.scroll({ stable_id, direction: step.direction, amount_px: step.amount_px });
        return;
      }
      case "navigate":
        await session.navigate(interpolate(step.url, args));
        return;
      case "wait_for":
      case "snapshot":
        // No-op for now (wait_for needs predicate-poller integration; defer to Phase E).
        return;
    }
  }

  // ---------------------------------------------------------------------------
  // dispatchAction — executes an ActionStep (from transition.action_sequence)
  //
  // ActionStep uses `intent: string` for click/type (not `target: IntentRef`),
  // so we build an IntentRef from the intent string and then delegate.
  // ---------------------------------------------------------------------------

  private async dispatchAction(
    session: SessionAdapter,
    action: ActionStep,
    _args: Record<string, unknown>,
  ): Promise<void> {
    switch (action.verb) {
      case "navigate":
        await session.navigate(action.url);
        return;
      case "click": {
        // ActionStep.click carries `intent: string` — pass as a generic role/name ref
        const snap = await session.snapshot();
        const ctx = this.findContext(snap);
        // Build IntentRef from the intent string (treat as button by default for BFS transitions)
        const ref: IntentRef = { role: "button", name: action.intent };
        const r = await resolveIntentRef(ref, ctx);
        if (!r.stable_id) throw new Error(`element_not_found (transition action): ${action.intent}`);
        await session.click(r.stable_id);
        return;
      }
      case "click_stable_id":
        await session.click(action.stable_id);
        return;
      case "type": {
        const snap = await session.snapshot();
        const ctx = this.findContext(snap);
        const ref: IntentRef = { role: "textbox", name: action.intent };
        const r = await resolveIntentRef(ref, ctx);
        if (!r.stable_id) throw new Error(`element_not_found (transition action): ${action.intent}`);
        await session.type(r.stable_id, action.text_arg);
        return;
      }
      case "press_key":
        await session.pressKey(action.key);
        return;
      case "wait_for":
      case "snapshot":
        return;
    }
  }

  // ---------------------------------------------------------------------------
  // adapt — convert opaque snapshot into SnapshotForPredicate
  // ---------------------------------------------------------------------------

  private adapt(snap: unknown, url: string): SnapshotForPredicate {
    const s = snap as Record<string, unknown>;
    const root = (s.root ?? s.tree) as AxTreeNode | undefined;
    return {
      url,
      // Provide a safe fallback root so predicate evaluation never crashes on
      // snapshots that lack a tree (e.g. navigate-only transitions).
      root: root ?? { i: "", r: "main", n: "" },
      network: s.network as SnapshotForPredicate["network"],
      forms: s.forms as SnapshotForPredicate["forms"],
      cookies: s.cookies as SnapshotForPredicate["cookies"],
    };
  }

  // ---------------------------------------------------------------------------
  // findContext — build the FindContext that resolveIntentRef needs
  // ---------------------------------------------------------------------------

  private findContext(snap: unknown): FindContext {
    const nodes = this.flattenAxNodes(snap);
    return { snapshot: { nodes }, cache: null };
  }

  // ---------------------------------------------------------------------------
  // flattenAxNodes — depth-first flatten of the AX tree into a flat node list
  // ---------------------------------------------------------------------------

  private flattenAxNodes(snap: unknown): Array<{ i: string; r: string; n: string }> {
    const out: Array<{ i: string; r: string; n: string }> = [];
    const s = snap as Record<string, unknown>;
    const root = (s.root ?? (s.tree as Record<string, unknown> | undefined)?.root) as AxTreeNode | undefined;
    if (!root) return out;

    const stack: AxTreeNode[] = [root];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.i && node.r && node.n) out.push({ i: node.i, r: node.r, n: node.n });
      for (const child of node.c ?? []) stack.push(child);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // finishOutcome — log observation side-effect then return outcome.
  // Observation logging MUST NOT throw; it is wrapped in try/catch.
  // ---------------------------------------------------------------------------

  private finishOutcome<T = unknown>(
    outcome: Outcome<T>,
    session: SessionAdapter,
  ): Outcome<T> {
    if (this.storage) {
      try {
        linkOutcomeToObservation(this.storage, this.site, session.currentUrl(), outcome as Outcome);
      } catch {
        // Observation logging must never break the intention.
      }
    }
    return outcome;
  }

  // ---------------------------------------------------------------------------
  // failOutcome — build a well-formed failure Outcome
  // ---------------------------------------------------------------------------

  private failOutcome<T = unknown>(
    intention: Intention,
    args: unknown,
    state_before: string | null,
    state_after: string | undefined,
    reason: FailureReason,
    detail: string,
    evidence: Evidence[],
    steps_observed: TransitionLog[],
    t0: number,
  ): Outcome<T> {
    return {
      ok: false,
      intention: intention.name,
      args,
      state_before,
      state_after,
      evidence,
      duration_ms: this.now() - t0,
      reason,
      reason_detail: detail,
      recovery_options: [{ label: recoveryStrategy(reason) }],
      steps_observed,
    };
  }
}
