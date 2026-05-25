/**
 * event-emitters.ts — M22 Phase E Tasks 3-5.
 *
 * Typed helper functions that build well-formed CognitionEvent objects and
 * publish them to a CognitionBus.  Each helper is a no-op when `bus` is
 * undefined, so callers can guard with a single optional parameter rather
 * than scattering `if (bus)` checks everywhere.
 *
 * T5 additions: captcha_detected, error_appeared (user_intervention_required
 * added in T6).
 */

import { randomUUID } from "node:crypto";
import type { CognitionBus } from "./cognition-bus.js";
import type { CognitionEvent } from "./events.js";
import type { Snapshot } from "../snapshot/types.js";
import { collectAllText } from "./predicate.js";

/**
 * Emit a `state_change` event into the bus.
 *
 * Callers are responsible for comparing from/to before calling — this
 * function publishes unconditionally (it does not skip from === to).
 */
export function emitStateChange(
  bus: CognitionBus,
  session_id: string,
  site: string,
  from_state: string | null,
  to_state: string,
  confidence?: number,
): void {
  const ev: CognitionEvent = {
    id: randomUUID(),
    ts: Date.now(),
    session_id,
    site,
    type: "state_change",
    payload: {
      from_state,
      to_state,
      ...(confidence !== undefined && { confidence }),
    },
  };
  bus.publish(ev);
}

// ---------------------------------------------------------------------------
// T4 — network_idle emitter
// ---------------------------------------------------------------------------

/**
 * Minimal interface that wireNetworkIdle requires from a session.
 * Session must expose:
 *   - `id`          — stable session identifier
 *   - `currentSite()` — current hostname (best-effort; may return "")
 *   - `networkBuffer` — NetworkBuffer public API surface needed here
 */
export interface NetworkIdleSession {
  readonly id: string;
  currentSite(): string;
  networkBuffer: {
    inFlightCount(): number;
    onResponseComplete(fn: () => void): () => void;
  };
}

/**
 * Wire a debounced network-idle detector into `session.networkBuffer`.
 *
 * After each response completes:
 *   - If in-flight count is 0, start a `debounce_ms` timer.
 *   - If a new response fires before the timer, restart the timer.
 *   - When the timer fires and in-flight is still 0, publish `network_idle`.
 *
 * Returns a cleanup function — call it from Session.close() to cancel any
 * pending timer and remove the response-complete listener.
 */
export function wireNetworkIdle(
  bus: CognitionBus,
  session: NetworkIdleSession,
  debounce_ms = 500,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const onComplete = (): void => {
    cancel();
    if (session.networkBuffer.inFlightCount() === 0) {
      timer = setTimeout(() => {
        timer = null;
        if (session.networkBuffer.inFlightCount() === 0) {
          const now = Date.now();
          const ev: CognitionEvent = {
            id: randomUUID(),
            ts: now,
            session_id: session.id,
            site: session.currentSite(),
            type: "network_idle",
            payload: { idle_since: now - debounce_ms, in_flight_count: 0 },
          };
          bus.publish(ev);
        }
      }, debounce_ms);
    }
  };

  const unsub = session.networkBuffer.onResponseComplete(onComplete);

  return (): void => {
    cancel();
    unsub();
  };
}

// ---------------------------------------------------------------------------
// T5 — captcha_detected emitter
// ---------------------------------------------------------------------------

/**
 * Keywords that classify a page-health reason as a captcha/bot-challenge signal.
 * Matched case-insensitively against AX full-text and console error text.
 */
const CAPTCHA_PATTERN = /captcha|recaptcha|bot.?challenge|unusual activity|cloudflare/i;

/**
 * Dedup state for captcha emission. Stored per-session by the caller.
 * `lastCaptchaKey` is the last matched keyword (first match from the AX text).
 * Emit is skipped when the key hasn't changed since the last snapshot cycle.
 */
export interface CaptchaDedupeState {
  lastCaptchaKey: string | null;
}

/**
 * Minimal session interface required by T5 emitters.
 */
export interface CognitionEmitterSession {
  readonly id: string;
  currentSite(): string;
}

/**
 * Inspect `snapshot` for captcha/bot-challenge signals (AX text + console errors).
 * When found, emit `captcha_detected` unless the same key was emitted last cycle.
 *
 * `dedup.lastCaptchaKey` is mutated on each call to track dedup state across
 * successive snapshot cycles.
 */
export function emitCaptchaIfDetected(
  bus: CognitionBus,
  session: CognitionEmitterSession,
  snapshot: Snapshot,
  dedup: CaptchaDedupeState,
): void {
  // Collect candidate texts: full AX tree text + error-level console messages.
  const axText = collectAllText(snapshot.root as unknown as Parameters<typeof collectAllText>[0]);
  const consoleErrors = (snapshot.console ?? [])
    .filter((m) => m.level === "error")
    .map((m) => m.text)
    .join(" ");

  const combined = `${axText} ${consoleErrors}`;
  const match = CAPTCHA_PATTERN.exec(combined);
  if (!match) {
    // No captcha signal — reset dedup key so a future captcha is treated as new.
    dedup.lastCaptchaKey = null;
    return;
  }

  // Normalise the matched keyword to lowercase as the dedup key.
  const key = match[0].toLowerCase();
  if (key === dedup.lastCaptchaKey) {
    // Same captcha already emitted for this continuous run — skip.
    return;
  }
  dedup.lastCaptchaKey = key;

  // Collect all matching reasons from the combined text for the payload.
  const reasons: string[] = [];
  let rem = combined;
  let m: RegExpExecArray | null;
  const pat = new RegExp(CAPTCHA_PATTERN.source, "gi");
  while ((m = pat.exec(rem)) !== null) {
    const k = m[0].toLowerCase();
    if (!reasons.includes(k)) reasons.push(k);
  }

  const ev: CognitionEvent = {
    id: randomUUID(),
    ts: Date.now(),
    session_id: session.id,
    site: session.currentSite(),
    type: "captcha_detected",
    payload: { kind: key, reasons },
  };
  bus.publish(ev);
}

// ---------------------------------------------------------------------------
// T5 — error_appeared emitter
// ---------------------------------------------------------------------------

/** Pattern for error banners in the AX tree. Conservative to reduce noise. */
const ERROR_BANNER_PATTERN = /error|failed|something went wrong|try again|invalid|denied/i;

/**
 * Dedup state for error emission. Stored per-session by the caller.
 * Tracks the set of `text` values emitted this snapshot cycle to prevent
 * duplicate events from multiple matching sources for the same text.
 */
export interface ErrorDedupeState {
  lastErrorTexts: Set<string>;
}

/**
 * Inspect `snapshot` for error signals from three sources:
 *   1. Console errors (level === "error") — kind = "console"
 *   2. AX tree text matching error patterns — kind = "banner"
 *   3. Pending JS dialog — kind = "dialog"
 *
 * Each unique text emits one `error_appeared` event. Texts already in
 * `dedup.lastErrorTexts` are skipped (dedup across successive snapshot
 * cycles for the same text). The dedup set is replaced on each call so
 * that new texts in the next snapshot cycle are never blocked.
 */
export function emitErrorIfPresent(
  bus: CognitionBus,
  session: CognitionEmitterSession,
  snapshot: Snapshot,
  dedup: ErrorDedupeState,
): void {
  const newTexts = new Set<string>();

  const maybeEmit = (kind: "console" | "banner" | "dialog", text: string): void => {
    const key = `${kind}:${text}`;
    if (dedup.lastErrorTexts.has(key)) return;
    if (newTexts.has(key)) return;
    newTexts.add(key);
    const ev: CognitionEvent = {
      id: randomUUID(),
      ts: Date.now(),
      session_id: session.id,
      site: session.currentSite(),
      type: "error_appeared",
      payload: { kind, text },
    };
    bus.publish(ev);
  };

  // Source 1: Console errors.
  for (const msg of snapshot.console ?? []) {
    if (msg.level === "error" && msg.text.trim().length > 0) {
      maybeEmit("console", msg.text);
    }
  }

  // Source 2: AX tree banner text.
  const axText = collectAllText(snapshot.root as unknown as Parameters<typeof collectAllText>[0]);
  if (ERROR_BANNER_PATTERN.test(axText)) {
    // Use the first matched sentence fragment (up to 120 chars) as the text payload.
    const fragment = axText.trim().slice(0, 120);
    maybeEmit("banner", fragment);
  }

  // Source 3: Pending JS dialog.
  if (snapshot.dialog) {
    maybeEmit("dialog", snapshot.dialog.message);
  }

  // Replace dedup state with the new set of emitted texts.
  dedup.lastErrorTexts = newTexts;
}
