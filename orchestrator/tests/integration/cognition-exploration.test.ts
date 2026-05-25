/**
 * Integration test: ExplorationHarness + real lightpanda session.
 *
 * Drives a 2-page navigation through a local fixture server and verifies
 * that the harness records 2 distinct states and 1 transition in SQLite.
 *
 * Skipped when LIGHTPANDA_BIN is unset (mirrors site-graph-e2e.test.ts).
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Session } from "../../src/session/session.js";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { CognitionStorage } from "../../src/cognition/storage.js";
import { ExplorationHarness } from "../../src/cognition/exploration.js";
import { locateLightpanda } from "../../src/engine/binary.js";
import type { SnapshotForPredicate, AxTreeNode } from "../../src/cognition/predicate.js";
import type { Snapshot } from "../../src/snapshot/types.js";

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
// Multi-page fixture server
// ---------------------------------------------------------------------------

interface MultiPageFixture {
  port: number;
  close(): Promise<void>;
}

const PAGE_A_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Page A</title></head>
<body>
  <main>
    <h1>Page A</h1>
    <a href="/page-b">Go to B</a>
  </main>
</body>
</html>`;

const PAGE_B_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Page B</title></head>
<body>
  <main>
    <h1>Page B</h1>
  </main>
</body>
</html>`;

async function startMultiPageFixture(): Promise<MultiPageFixture> {
  const server: Server = createServer((req, res) => {
    if (req.url === "/page-b") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE_B_HTML);
    } else {
      // /page-a and anything else → serve Page A
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE_A_HTML);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

// ---------------------------------------------------------------------------
// Snapshot adapter: Snapshot → SnapshotForPredicate
//
// Snapshot.root is SnapshotNode which has the same i/r/n/c fields as
// AxTreeNode — the predicate evaluator only reads those, so casting is safe.
// We also forward network, forms, and cookies so all predicate primitives work.
// ---------------------------------------------------------------------------

function adapt(snap: Snapshot): SnapshotForPredicate {
  return {
    url: snap.url,
    // SnapshotNode has i/r/n/c which fully satisfies AxTreeNode
    root: snap.root as unknown as AxTreeNode,
    network: snap.network
      ? {
          recent: snap.network.recent.map((e) => ({
            url: e.url,
            method: e.method,
            status: e.status,
            content_type: e.content_type,
          })),
        }
      : undefined,
    forms: snap.forms
      ? snap.forms.map((f) => ({
          fields: f.fields.map((field) => ({
            type: field.type,
            name: field.name,
          })),
        }))
      : undefined,
    // Snapshot does not expose cookies in its envelope (session.exportCookies()
    // is a separate call); cookies are not needed for URL/AX predicates.
    cookies: undefined,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

integrationOrSkip(
  "cognition exploration e2e — ExplorationHarness + lightpanda",
  () => {
    it(
      "drives 2-page navigation; harness records 2 states + 1 transition",
      async () => {
        // Unique temp dir for this test run so it doesn't collide with anything.
        const suffix = randomBytes(8).toString("hex");
        const cacheDir = join(tmpdir(), `husk-cognition-e2e-${suffix}`);
        const cache = new SiteGraphCache({ cacheDir });
        const storage = new CognitionStorage(cache);
        const fixture = await startMultiPageFixture();
        let session: Session | undefined;

        try {
          // Create a real Session (spawns lightpanda, opens CDP).
          session = await Session.create({
            readinessTimeoutMs: 15_000,
            siteGraph: cache,
          });

          const harness = new ExplorationHarness({
            site: "fixture.local",
            session_id: "test-session",
            storage,
          });

          // --- Navigate to Page A and observe ---
          await session.goto(`http://127.0.0.1:${fixture.port}/page-a`);
          const snap1 = await session.snapshot();
          harness.observe(adapt(snap1));

          // Sanity check: snap1 must have Page A content
          expect(snap1.url).toContain("/page-a");

          // --- Navigate to Page B and observe with a synthetic action ---
          await session.goto(`http://127.0.0.1:${fixture.port}/page-b`);
          const snap2 = await session.snapshot();
          harness.observe(adapt(snap2), { verb: "press_key", key: "Enter" });

          // Sanity check: snap2 must have Page B content
          expect(snap2.url).toContain("/page-b");

          // --- Assertions ---

          // Two distinct states (page-a and page-b have different URLs → different state IDs).
          const states = storage.listStates("fixture.local");
          expect(states.length).toBe(2);

          // One transition between the two states.
          const transitions = storage.getTransitions("fixture.local");
          expect(transitions.length).toBe(1);

          // The transition action sequence should match what we passed.
          expect(transitions[0].action_sequence).toEqual([
            { verb: "press_key", key: "Enter" },
          ]);

          // The transition should link the two states.
          const stateIds = new Set(states.map((s) => s.state_id));
          expect(stateIds.has(transitions[0].from_state)).toBe(true);
          expect(stateIds.has(transitions[0].to_state)).toBe(true);
          expect(transitions[0].from_state).not.toBe(transitions[0].to_state);
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
