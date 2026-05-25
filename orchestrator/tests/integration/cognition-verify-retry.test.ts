/**
 * Integration test: verify-retry path end-to-end against real lightpanda.
 *
 * Drives a fixture server with a "Welcome to Husk" page and exercises:
 *   1. Polling timeout — verify check for "ImpossibleString" times out → ok:false,
 *      reason:verify_failed, evidence[0].attempts >= 2.
 *   2. text_present passes — intention with verify:[{type:"text_present",
 *      pattern:"Welcome"}] → ok:true, evidence[0].passed:true, source:"text".
 *   3. text_absent passes — same fixture, verify:[{type:"text_absent",
 *      pattern:"Error"}] → ok:true, evidence[0].passed:true.
 *
 * Skipped when LIGHTPANDA_BIN is unset (mirrors cognition-intend.test.ts).
 */

import { describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Session } from "../../src/session/session.js";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { CognitionStorage } from "../../src/cognition/storage.js";
import { IntentionStore } from "../../src/cognition/intention-store.js";
import { locateLightpanda } from "../../src/engine/binary.js";

// ---------------------------------------------------------------------------
// Skip guard — only run when lightpanda is available
// ---------------------------------------------------------------------------

const integrationOrSkip = await (async () => {
  try {
    await locateLightpanda();
    return describe;
  } catch {
    return describe.skip;
  }
})();

// ---------------------------------------------------------------------------
// Fixture server — a single page containing "Welcome to Husk" (no "Error").
// ---------------------------------------------------------------------------

const WELCOME_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Welcome</title></head>
<body>
  <main>
    <h1>Welcome to Husk</h1>
    <p>The browser engine for AI agents.</p>
  </main>
</body>
</html>`;

interface FixtureServer {
  port: number;
  close(): Promise<void>;
}

async function startFixture(): Promise<FixtureServer> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(WELCOME_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

integrationOrSkip(
  "cognition verify-retry e2e (lightpanda)",
  () => {
    it(
      "polling verify times out → ok:false, verify_failed, attempts >= 2",
      async () => {
        const suffix = randomBytes(8).toString("hex");
        const cacheDir = join(tmpdir(), `husk-verify-retry-e2e-${suffix}`);
        const cache = new SiteGraphCache({ cacheDir });
        const storage = new CognitionStorage(cache);
        const intentionStore = new IntentionStore(cache.db);
        const fixture = await startFixture();
        const site = "127.0.0.1";
        const now = Date.now();
        let session: Session | undefined;

        try {
          // Pre-seed state so identifyCurrentState succeeds.
          storage.upsertState({
            site,
            state_id: "welcome",
            identify_by: { type: "url_pattern", regex: "/" },
            affordances: [],
            observed_count: 1,
            confidence: 0.9,
            last_seen_at: now,
          });

          // Intention: verify requires "ImpossibleString" with a short timeout.
          // The fixture page never contains this string — polling exhausts budget.
          intentionStore.upsert({
            site,
            name: "wait_impossible",
            args_schema: {},
            // No requires_state — the compiler skips state navigation.
            steps: [],
            verify: [
              {
                type: "text_present",
                pattern: "ImpossibleString",
                description: "waits for text that never appears",
                retry: { timeout_ms: 100, interval_ms: 20 },
              },
            ],
            failure_modes: [],
            created_at: now,
            updated_at: now,
          });

          session = await Session.create({
            readinessTimeoutMs: 15_000,
            siteGraph: cache,
          });

          await session.goto(`http://127.0.0.1:${fixture.port}/`);

          const outcome = await session.intend({
            intention_name: "wait_impossible",
            site,
          });

          expect(outcome.ok).toBe(false);
          expect(outcome.reason).toBe("verify_failed");
          expect(outcome.evidence.length).toBeGreaterThan(0);
          expect(outcome.evidence[0].attempts).toBeGreaterThanOrEqual(2);
        } finally {
          await session?.close();
          await fixture.close();
          cache.close();
          rmSync(cacheDir, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "text_present verify passes → ok:true, evidence[0].passed:true, source:'text'",
      async () => {
        const suffix = randomBytes(8).toString("hex");
        const cacheDir = join(tmpdir(), `husk-verify-retry-e2e-${suffix}`);
        const cache = new SiteGraphCache({ cacheDir });
        const storage = new CognitionStorage(cache);
        const intentionStore = new IntentionStore(cache.db);
        const fixture = await startFixture();
        const site = "127.0.0.1";
        const now = Date.now();
        let session: Session | undefined;

        try {
          // Pre-seed state.
          storage.upsertState({
            site,
            state_id: "welcome",
            identify_by: { type: "url_pattern", regex: "/" },
            affordances: [],
            observed_count: 1,
            confidence: 0.9,
            last_seen_at: now,
          });

          // Intention: verify text_present for "Welcome" — fixture has <h1>Welcome to Husk</h1>.
          intentionStore.upsert({
            site,
            name: "check_welcome",
            args_schema: {},
            steps: [],
            verify: [
              {
                type: "text_present",
                pattern: "Welcome",
                description: "shows welcome heading",
              },
            ],
            failure_modes: [],
            created_at: now,
            updated_at: now,
          });

          session = await Session.create({
            readinessTimeoutMs: 15_000,
            siteGraph: cache,
          });

          await session.goto(`http://127.0.0.1:${fixture.port}/`);

          const outcome = await session.intend({
            intention_name: "check_welcome",
            site,
          });

          expect(outcome.ok).toBe(true);
          expect(outcome.evidence.length).toBeGreaterThan(0);
          expect(outcome.evidence[0].passed).toBe(true);
          expect(outcome.evidence[0].source).toBe("text");
        } finally {
          await session?.close();
          await fixture.close();
          cache.close();
          rmSync(cacheDir, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "text_absent verify passes → ok:true when bad string is absent",
      async () => {
        const suffix = randomBytes(8).toString("hex");
        const cacheDir = join(tmpdir(), `husk-verify-retry-e2e-${suffix}`);
        const cache = new SiteGraphCache({ cacheDir });
        const storage = new CognitionStorage(cache);
        const intentionStore = new IntentionStore(cache.db);
        const fixture = await startFixture();
        const site = "127.0.0.1";
        const now = Date.now();
        let session: Session | undefined;

        try {
          // Pre-seed state.
          storage.upsertState({
            site,
            state_id: "welcome",
            identify_by: { type: "url_pattern", regex: "/" },
            affordances: [],
            observed_count: 1,
            confidence: 0.9,
            last_seen_at: now,
          });

          // Intention: verify text_absent for "Error" — fixture page has no error text.
          intentionStore.upsert({
            site,
            name: "check_no_error",
            args_schema: {},
            steps: [],
            verify: [
              {
                type: "text_absent",
                pattern: "Error",
                description: "no error visible on page",
              },
            ],
            failure_modes: [],
            created_at: now,
            updated_at: now,
          });

          session = await Session.create({
            readinessTimeoutMs: 15_000,
            siteGraph: cache,
          });

          await session.goto(`http://127.0.0.1:${fixture.port}/`);

          const outcome = await session.intend({
            intention_name: "check_no_error",
            site,
          });

          expect(outcome.ok).toBe(true);
          expect(outcome.evidence.length).toBeGreaterThan(0);
          expect(outcome.evidence[0].passed).toBe(true);
        } finally {
          await session?.close();
          await fixture.close();
          cache.close();
          rmSync(cacheDir, { recursive: true, force: true });
        }
      },
      60_000,
    );
  },
);
