/**
 * event-emitters.test.ts — M22 Phase E Task 5.
 *
 * 8 tests covering emitCaptchaIfDetected and emitErrorIfPresent:
 *  1. Captcha pattern in page-health reasons → captcha_detected fires
 *  2. No captcha in reasons → no captcha emit
 *  3. Console error matching pattern → error_appeared (kind=console)
 *  4. AX text matching error pattern → error_appeared (kind=banner)
 *  5. JS dialog in snapshot → error_appeared (kind=dialog)
 *  6. Same captcha key twice → only one emit (dedupe)
 *  7. Different captcha keys → two emits
 *  8. Empty/clean snapshot → no events
 */

import { describe, it, expect, vi } from "vitest";
import { CognitionBus } from "../../src/cognition/cognition-bus.js";
import {
  emitCaptchaIfDetected,
  emitErrorIfPresent,
  type CaptchaDedupeState,
  type ErrorDedupeState,
} from "../../src/cognition/event-emitters.js";
import type { CognitionEvent } from "../../src/cognition/events.js";
import type { Snapshot, SnapshotNode } from "../../src/snapshot/types.js";

// ---------------------------------------------------------------------------
// Minimal snapshot builder helpers
// ---------------------------------------------------------------------------

function makeRoot(text = ""): SnapshotNode {
  return { i: "root", r: "WebArea", n: text, c: [] };
}

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    url: "https://example.com/",
    count: 1,
    root: makeRoot(),
    signature: "sig",
    ...overrides,
  } as unknown as Snapshot;
}

function makeSessionStub(id = "sess-t5") {
  return {
    id,
    currentSite: () => "example.com",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("emitCaptchaIfDetected", () => {
  it("1. emits captcha_detected when reasons include a captcha-like keyword", () => {
    const bus = new CognitionBus();
    const received: CognitionEvent[] = [];
    bus.subscribe("captcha_detected", {}, (e) => received.push(e));

    const session = makeSessionStub();
    const snap = makeSnapshot({
      root: makeRoot("Please complete the reCAPTCHA"),
    });
    // Simulate detectPageHealth returning captcha reasons by passing them directly.
    // We override the snapshot console with a captcha-type reason in the AX tree.
    // For simplicity we rely on the real detectPageHealth OR we use reasons override —
    // the implementation accepts the snapshot and derives reasons internally.
    // Use a snapshot that will trigger the captcha detector via AX text.
    const captchaSnap = makeSnapshot({
      root: makeRoot("recaptcha verification required"),
      console: [],
    });

    const dedup: CaptchaDedupeState = { lastCaptchaKey: null };
    emitCaptchaIfDetected(bus, session, captchaSnap, dedup);

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("captcha_detected");
    expect(received[0].session_id).toBe("sess-t5");
  });

  it("2. does not emit when no captcha patterns present", () => {
    const bus = new CognitionBus();
    const received: CognitionEvent[] = [];
    bus.subscribe("captcha_detected", {}, (e) => received.push(e));

    const session = makeSessionStub();
    const snap = makeSnapshot({
      root: makeRoot("Welcome to Example Corp"),
      console: [],
    });

    const dedup: CaptchaDedupeState = { lastCaptchaKey: null };
    emitCaptchaIfDetected(bus, session, snap, dedup);

    expect(received).toHaveLength(0);
  });

  it("6. dedupes: same captcha key twice → only one emit", () => {
    const bus = new CognitionBus();
    const received: CognitionEvent[] = [];
    bus.subscribe("captcha_detected", {}, (e) => received.push(e));

    const session = makeSessionStub();
    const snap = makeSnapshot({
      root: makeRoot("cloudflare bot challenge detected"),
      console: [],
    });

    const dedup: CaptchaDedupeState = { lastCaptchaKey: null };
    // First call: should emit.
    emitCaptchaIfDetected(bus, session, snap, dedup);
    // Second call with same snapshot/key: should be deduped.
    emitCaptchaIfDetected(bus, session, snap, dedup);

    expect(received).toHaveLength(1);
  });

  it("7. different captcha keys → two emits", () => {
    const bus = new CognitionBus();
    const received: CognitionEvent[] = [];
    bus.subscribe("captcha_detected", {}, (e) => received.push(e));

    const session = makeSessionStub();

    const dedup: CaptchaDedupeState = { lastCaptchaKey: null };

    // First snapshot: recaptcha pattern.
    const snap1 = makeSnapshot({
      root: makeRoot("recaptcha required"),
      console: [],
    });
    emitCaptchaIfDetected(bus, session, snap1, dedup);

    // Second snapshot: cloudflare pattern (different key).
    const snap2 = makeSnapshot({
      root: makeRoot("cloudflare unusual activity detected"),
      console: [],
    });
    emitCaptchaIfDetected(bus, session, snap2, dedup);

    expect(received).toHaveLength(2);
  });
});

describe("emitErrorIfPresent", () => {
  it("3. emits error_appeared(kind=console) when console has a matching error", () => {
    const bus = new CognitionBus();
    const received: CognitionEvent[] = [];
    bus.subscribe("error_appeared", {}, (e) => received.push(e));

    const session = makeSessionStub();
    const snap = makeSnapshot({
      root: makeRoot("Normal page content"),
      console: [
        { level: "error", text: "Uncaught TypeError: failed to fetch", ts: Date.now() },
      ],
    });

    const dedup: ErrorDedupeState = { lastErrorTexts: new Set() };
    emitErrorIfPresent(bus, session, snap, dedup);

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("error_appeared");
    const payload = received[0].payload as { kind: string; text: string };
    expect(payload.kind).toBe("console");
    expect(payload.text).toContain("failed to fetch");
  });

  it("4. emits error_appeared(kind=banner) when AX tree contains error pattern text", () => {
    const bus = new CognitionBus();
    const received: CognitionEvent[] = [];
    bus.subscribe("error_appeared", {}, (e) => received.push(e));

    const session = makeSessionStub();
    const snap = makeSnapshot({
      root: makeRoot("Something went wrong. Please try again later."),
      console: [],
    });

    const dedup: ErrorDedupeState = { lastErrorTexts: new Set() };
    emitErrorIfPresent(bus, session, snap, dedup);

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("error_appeared");
    const payload = received[0].payload as { kind: string; text: string };
    expect(payload.kind).toBe("banner");
  });

  it("5. emits error_appeared(kind=dialog) when snapshot.dialog is present", () => {
    const bus = new CognitionBus();
    const received: CognitionEvent[] = [];
    bus.subscribe("error_appeared", {}, (e) => received.push(e));

    const session = makeSessionStub();
    const snap = makeSnapshot({
      root: makeRoot("Normal page"),
      console: [],
      dialog: { type: "alert", message: "Connection error occurred" },
    });

    const dedup: ErrorDedupeState = { lastErrorTexts: new Set() };
    emitErrorIfPresent(bus, session, snap, dedup);

    expect(received).toHaveLength(1);
    const payload = received[0].payload as { kind: string; text: string };
    expect(payload.kind).toBe("dialog");
    expect(payload.text).toContain("Connection error occurred");
  });

  it("8. empty/clean snapshot → no events emitted", () => {
    const bus = new CognitionBus();
    const captchaReceived: CognitionEvent[] = [];
    const errorReceived: CognitionEvent[] = [];
    bus.subscribe("captcha_detected", {}, (e) => captchaReceived.push(e));
    bus.subscribe("error_appeared", {}, (e) => errorReceived.push(e));

    const session = makeSessionStub();
    const snap = makeSnapshot({
      root: makeRoot("Welcome! Everything is working fine."),
      console: [],
    });

    const captchaDedup: CaptchaDedupeState = { lastCaptchaKey: null };
    const errorDedup: ErrorDedupeState = { lastErrorTexts: new Set() };

    emitCaptchaIfDetected(bus, session, snap, captchaDedup);
    emitErrorIfPresent(bus, session, snap, errorDedup);

    expect(captchaReceived).toHaveLength(0);
    expect(errorReceived).toHaveLength(0);
  });
});
