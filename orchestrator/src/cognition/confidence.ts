/**
 * Confidence engine for state transitions.
 *
 * Pure math module for computing confidence scores and reliability rankings.
 * No I/O, no external dependencies.
 */

/**
 * Initial confidence for a newly discovered transition.
 */
export function newTransitionConfidence(): number {
  return 0.5;
}

/**
 * Apply success: increment confidence by 0.05, cap at 0.99.
 */
export function applySuccess(current: number): number {
  return Math.min(0.99, current + 0.05);
}

/**
 * Apply failure: decrement confidence by 0.10, floor at 0.05.
 */
export function applyFailure(current: number): number {
  return Math.max(0.05, current - 0.1);
}

/**
 * Apply weekly decay: reduce confidence by 0.01 per week elapsed,
 * using integer floor of weeks. Floors final result at 0.05.
 *
 * @param current Current confidence score
 * @param last_used_at Unix milliseconds of last use
 * @param now_at Unix milliseconds of current time
 * @returns Decayed confidence, floored at 0.05
 */
export function decay(current: number, last_used_at: number, now_at: number): number {
  // Short-circuit: if time is negative or zero, no decay
  if (now_at <= last_used_at) {
    return current;
  }

  const elapsed_ms = now_at - last_used_at;
  const week_ms = 7 * 24 * 60 * 60 * 1000;
  const weeks_elapsed = Math.floor(elapsed_ms / week_ms);

  const decayed = current - weeks_elapsed * 0.01;
  return Math.max(0.05, decayed);
}

/**
 * Compute reliability score for ranking transitions.
 * Uses Laplace smoothing: success_count / (success_count + failure_count + 2).
 *
 * @param t Object with success_count and failure_count
 * @returns Reliability score in [0, 1]
 */
export function reliability(t: {
  success_count: number;
  failure_count: number;
}): number {
  return t.success_count / (t.success_count + t.failure_count + 2);
}
