import type { FailureReason } from "./intention-types.js";

/** Human-facing recovery hint for each failure reason. */
const RECOVERY_STRATEGIES: Record<FailureReason, string> = {
  unknown_site: "Drive the site in exploration mode first so the graph can learn.",
  unknown_state: "Take a snapshot and use the state-recovery flow (deferred to Phase C).",
  no_path_to_target: "Either define a transition or extend the state graph.",
  state_drift_mid_execution: "Site moved unexpectedly; replan from the new state.",
  verify_failed: "The action ran but the post-condition was not observed.",
  element_not_found: "Selector resolved nothing in the current snapshot.",
  element_not_interactive: "Element exists but is disabled/hidden.",
  watchdog_rejected: "Watchdog policy blocked the action.",
  timeout: "Operation exceeded its wait budget.",
  network_failure: "Underlying network request failed.",
  network_timeout: "Network call timed out.",
  network_throttled: "Server signaled throttling (HTTP 503/throttled headers).",
  rate_limited: "Server returned 429 or rate-limit messaging.",
  account_locked: "Account is locked; needs human intervention.",
  bot_challenge: "Site flagged us as a bot; escalate via seamless handoff.",
  two_factor_required: "2FA prompt encountered; needs TOTP or human.",
  permission_denied: "User lacks permission for this action.",
  content_not_found: "Target content (page/profile/post) does not exist.",
  feature_unavailable: "Site does not expose this capability for this user.",
  needs_human: "Explicit handoff requested.",
  needs_credentials: "No stored creds for this site.",
  needs_2fa_code: "Need a one-time code from the user.",
  needs_payment_confirmation: "Payment requires user approval.",
  human_declined: "User refused to continue.",
  human_timeout: "User did not respond in time.",
  engine_unsupported: "Selected engine cannot run this site.",
  engine_crashed: "Engine process died mid-action.",
  out_of_memory: "Engine ran out of memory.",
  pool_exhausted: "No engines available; pool at capacity.",
  unknown_error: "Unclassified runtime failure; check reason_detail.",
};

export function recoveryStrategy(reason: FailureReason): string {
  return RECOVERY_STRATEGIES[reason];
}

/** Classify a thrown error into a typed FailureReason. Best-effort heuristic. */
export function classifyError(err: unknown): { reason: FailureReason; detail: string } {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (/rate.?limit|429|too many requests/.test(msg)) return { reason: "rate_limited", detail: err.message };
    if (/2fa|two.?factor|totp|verification code/.test(msg)) return { reason: "two_factor_required", detail: err.message };
    if (/captcha|robot|bot.?challenge|unusual activity/.test(msg)) return { reason: "bot_challenge", detail: err.message };
    if (/timeout|timed? out/.test(msg)) return { reason: "timeout", detail: err.message };
    if (/network|fetch failed|econnreset|enotfound/.test(msg)) return { reason: "network_failure", detail: err.message };
    if (/not found|404|no such element/.test(msg)) return { reason: "element_not_found", detail: err.message };
    if (/permission|forbidden|403/.test(msg)) return { reason: "permission_denied", detail: err.message };
    if (/watchdog|policy/.test(msg)) return { reason: "watchdog_rejected", detail: err.message };
    if (/out of memory|enomem|oom/.test(msg)) return { reason: "out_of_memory", detail: err.message };
    if (/crashed|killed|exited/.test(msg)) return { reason: "engine_crashed", detail: err.message };
    return { reason: "unknown_error", detail: err.message };
  }
  return { reason: "unknown_error", detail: String(err) };
}
