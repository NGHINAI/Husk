/**
 * M16 T8 — Seamless handoff end-to-end smoke test.
 *
 * Exercises the full T1→T5 chain (chrome-launcher → chrome-watcher →
 * completion-detector → cookie-sync → seamless-orchestrator) against a
 * minimal local fixture HTTP server that auto-redirects /login → /feed after
 * a 1-second meta-refresh. Chrome navigates to /login, the redirect fires,
 * runSeamlessHandoff() detects the URL change, and resolves with resumed:true.
 *
 * Guards:
 *   - HUSK_INT=1 (generic integration gate — avoids running in unit-test mode)
 *   - HUSK_SMOKE_CHROME=1 (opt-in: requires a real Chrome binary)
 *   - findChrome() !== null (Chrome must actually be installed on this machine)
 *
 * All three guards must be true for the suite to run; otherwise it is skipped.
 * CI leaves HUSK_SMOKE_CHROME unset, so the test is always skipped there.
 */

import { describe, it, expect } from "vitest";
import { findChrome } from "../../src/handoff/chrome-launcher.js";

const HUSK_INT = !!process.env.HUSK_INT;
const HUSK_SMOKE_CHROME = !!process.env.HUSK_SMOKE_CHROME;
const CHROME_AVAILABLE = HUSK_SMOKE_CHROME && findChrome() !== null;
const d = HUSK_INT && CHROME_AVAILABLE ? describe : describe.skip;

d(
  "seamless handoff e2e (requires HUSK_INT=1 + HUSK_SMOKE_CHROME=1 + Chrome installed)",
  () => {
    it(
      "can spawn Chrome and detect a 'login complete' navigation via URL change",
      async () => {
        // Minimal flow: spawn Chrome at a local fixture URL that auto-redirects
        // after a tick; the orchestrator should detect the redirect (not on
        // /login anymore) and complete. This exercises the full T1→T5 chain
        // without lightpanda involvement.

        const {
          runSeamlessHandoff,
          findFreePort,
          spawnChrome,
          createHandoffProfileDir,
          connectToChrome,
        } = await import("../../src/handoff/index.js");
        const { rm } = await import("node:fs/promises");

        // A tiny fixture server: serves /login that immediately redirects to /feed
        const http = await import("node:http");
        let serverPort = 0;
        const server = http.createServer((req, res) => {
          if (req.url === "/login") {
            // 200 with meta-refresh to /feed in 1s — simulates a login that
            // immediately succeeds
            res.writeHead(200, { "content-type": "text/html" });
            res.end(
              '<html><head><meta http-equiv="refresh" content="1;url=/feed"></head><body>logging in</body></html>',
            );
          } else if (req.url === "/feed") {
            res.writeHead(200, { "content-type": "text/html" });
            res.end("<html><body>welcome</body></html>");
          } else {
            res.writeHead(404).end();
          }
        });
        await new Promise<void>((r) =>
          server.listen(0, "127.0.0.1", () => r()),
        );
        serverPort = (server.address() as { port: number }).port;
        const targetUrl = `http://127.0.0.1:${serverPort}/login`;

        const result = await runSeamlessHandoff({
          session: { importCookies: async () => 0 },
          targetUrl,
          timeoutMs: 15_000,
          token: "smoke-test-token",
          huskPort: 7777,
          findChrome,
          spawnChrome,
          connectToChrome,
          createProfileDir: createHandoffProfileDir,
          cleanupProfileDir: async (dir) => {
            await rm(dir, { recursive: true, force: true }).catch(() => {});
          },
        });

        server.close();

        expect(result.resumed).toBe(true);
        expect(result.ms_paused).toBeGreaterThan(500); // at least the meta-refresh delay
      },
      30_000,
    );
  },
);
