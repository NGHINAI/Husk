export type {
  StateId,
  Predicate,
  SiteState,
  Transition,
  ActionStep,
  Observation,
} from "./types.js";

export type { SnapshotForPredicate, AxTreeNode } from "./predicate.js";
export { evaluate } from "./predicate.js";

export { StateGraph } from "./state-graph.js";
export { CognitionStorage } from "./storage.js";

export {
  newTransitionConfidence,
  applySuccess,
  applyFailure,
  decay,
  reliability,
} from "./confidence.js";

export type { ExplorationOptions } from "./exploration.js";
export {
  ExplorationHarness,
  escapeRegex,
  normalizeUrl,
  mostDistinctiveAxNodes,
  signatureOf,
} from "./exploration.js";

// M19 Phase B — intention compiler layer
export type {
  VerifyCheck,
  FailureModePattern,
  IntentRef,
  IntentionStep,
  Intention,
  FailureReason,
  Evidence,
  TransitionLog,
  Outcome,
} from "./intention-types.js";

export { classifyError, recoveryStrategy } from "./failure-taxonomy.js";
export { IntentionStore } from "./intention-store.js";
export { parseIntentionYaml, interpolate } from "./intention-yaml.js";
export { intentRefToString, resolveIntentRef } from "./intent-resolver.js";
export type { IntentResolveResult } from "./intent-resolver.js";
export { runVerify, runAllVerify } from "./verify-runner.js";
export type { NetworkEntry, VerifyContext } from "./verify-runner.js";
export { IntentionCompiler } from "./intention-compiler.js";
export type { SessionAdapter, CompilerOptions } from "./intention-compiler.js";
