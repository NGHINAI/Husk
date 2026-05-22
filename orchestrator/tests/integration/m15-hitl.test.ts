/**
 * M15 T9 — Real lightpanda end-to-end test: multi-tab + ask_human + handoff.
 *
 * Tests three M15 slices end-to-end with real lightpanda + real HTTP server:
 *   1. Multi-tab: parent creates children; siblings visible in snapshot;
 *      cascade-close on parent removes all sessions.
 *   2. ask_human dual-surface: Watch UI POST resolves AND husk_resume resolves.
 *   3. handoff dual-surface: Watch UI POST resumes AND husk_resume resumes;
 *      /handoff/:token HTML serves with token/reason/current_url substituted.
 *
 * Guard: skipped when LIGHTPANDA_BIN is unset and no lightpanda is on PATH.
 *
 * Known lightpanda limitation (documented, not a test failure):
 *   importCookies internally uses Network.setCookies, which lightpanda may not
 *   implement fully. The tests verify the session UNPAUSES (which is the
 *   contractually important part); they do NOT assert cookies are actually
 *   installed in the engine. The cookie-install path is covered by unit tests.
 *
 * Architecture note on cookie sharing between tabs:
 *   Each session is its own lightpanda process, so sessions share cookies only
 *   via the explicit `profile` mechanism (VaultStore). Parents without an
 *   explicit profile give each child an isolated cookie jar — that is a
 *   lightpanda limitation, not a Husk bug. These tests exercise the tab GROUP
 *   accounting (sibling_sessions), not cookie sharing.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHuskServer } from "../../src/http/server.js";
import { SessionManager } from "../../src/session/manager.js";
import { Session } from "../../src/session/session.js";
import { WatchBus } from "../../src/watch/sse.js";
import { HumanIOBus } from "../../src/hitl/bus.js";
import { VaultStore } from "../../src/vault/store.js";
import { locateLightpanda } from "../../src/engine/binary.js";

// ---------------------------------------------------------------------------
// Integration guard — skip all tests if lightpanda is not available
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
// Minimal fixture server (serves a simple page for handoff URL tests)
// ---------------------------------------------------------------------------
async function startFixtureServer(): Promise<{ port: number; stop: () => Promise<void> }> {
  const HTML = `<!doctype html><html><head><meta charset="UTF-8"><title>M15 Fixture</title></head>
<body><h1>M15 HITL Fixture</h1><button id="btn">Click me</button></body></html>`;

  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    stop: () => new Promise<void>((r, j) => server.close((err) => (err ? j(err) : r()))),
  };
}

// ---------------------------------------------------------------------------
// Minimal stub vault + credentials required by createHuskServer
// ---------------------------------------------------------------------------
function makeVault(): { vault: VaultStore; cleanup: () => void } {
  const vaultDir = mkdtempSync(join(tmpdir(), "husk-m15-test-vault-"));
  const vault = new VaultStore({ vaultDir });
  return {
    vault,
    cleanup: () => {
      vault.close();
      rmSync(vaultDir, { recursive: true, force: true });
    },
  };
}

function makeCredentials() {
  return {
    listProfiles: () => [],
    list: () => [],
    get: () => null,
    set: () => {},
    remove: () => {},
    close: () => {},
  } as import("../../src/credentials/store.js").CredentialsStore;
}

// ---------------------------------------------------------------------------
// Start an in-process HuskServer wired with real lightpanda sessions
// ---------------------------------------------------------------------------
async function startOrchestrator(): Promise<{ port: number; stop: () => Promise<void> }> {
  const watchBus = new WatchBus();
  const humanIO = new HumanIOBus();
  const { vault, cleanup: vaultCleanup } = makeVault();
  const credentials = makeCredentials();

  const sessions = new SessionManager(
    (opts) => Session.create({ ...opts, vault, readinessTimeoutMs: 20_000 }),
    watchBus,
  );

  const server = await createHuskServer({
    port: 0, // ephemeral
    host: "127.0.0.1",
    sessions,
    version: "0.0.0-m15-test",
    logLevel: "silent",
    vault,
    credentials,
    watchBus,
    humanIO,
  });

  return {
    port: server.port,
    stop: async () => {
      await sessions.closeAll();
      await server.stop();
      vaultCleanup();
    },
  };
}

// ---------------------------------------------------------------------------
// JSON-RPC helper — throws on error envelope, returns result on success
// ---------------------------------------------------------------------------
async function rpc(port: number, method: string, params: unknown): Promise<unknown> {
  const r = await fetch(`http://127.0.0.1:${port}/v1/jsonrpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Math.random(), method, params }),
  });
  const j = (await r.json()) as { result?: unknown; error?: { code: number; message: string } };
  if (j.error) throw new Error(`RPC ${method} error: ${JSON.stringify(j.error)}`);
  return j.result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
integrationOrSkip("M15 HITL + multi-tab (lightpanda end-to-end)", () => {
  let fx: { port: number; stop: () => Promise<void> };
  let orc: { port: number; stop: () => Promise<void> };

  beforeAll(async () => {
    fx = await startFixtureServer();
    orc = await startOrchestrator();
  }, 60_000);

  afterAll(async () => {
    if (orc) await orc.stop();
    if (fx) await fx.stop();
  });

  // =========================================================================
  // 1. Multi-tab
  // =========================================================================
  describe("multi-tab", () => {
    it("parent + 2 children see each other in sibling_sessions; cascade close removes all", async () => {
      const parent = (await rpc(orc.port, "create_session", {})) as { session_id: string };
      const child1 = (await rpc(orc.port, "create_session", { parent_session_id: parent.session_id })) as { session_id: string };
      const child2 = (await rpc(orc.port, "create_session", { parent_session_id: parent.session_id })) as { session_id: string };

      const snapP = (await rpc(orc.port, "snapshot", { session_id: parent.session_id })) as { sibling_sessions: string[] };
      const snapC1 = (await rpc(orc.port, "snapshot", { session_id: child1.session_id })) as { sibling_sessions: string[] };

      // Parent sees both children; child1 sees parent + sibling child2
      expect(new Set(snapP.sibling_sessions)).toEqual(new Set([child1.session_id, child2.session_id]));
      expect(new Set(snapC1.sibling_sessions)).toEqual(new Set([parent.session_id, child2.session_id]));

      // Cascade-close by closing the root (parent)
      await rpc(orc.port, "close_session", { session_id: parent.session_id });

      // Subsequent snapshot on a closed child should fail with a JSON-RPC error
      await expect(rpc(orc.port, "snapshot", { session_id: child1.session_id })).rejects.toThrow();
    }, 60_000);

    it("create_session with unknown parent_session_id fails cleanly", async () => {
      await expect(
        rpc(orc.port, "create_session", { parent_session_id: "ghost-session-id-does-not-exist" })
      ).rejects.toThrow(/parent|unknown/i);
    }, 30_000);
  });

  // =========================================================================
  // 2. ask_human dual-surface
  // =========================================================================
  describe("ask_human dual-surface", () => {
    it("Watch-UI path: ask_human → POST /ask/:token/answer → resolves ok", async () => {
      const session = (await rpc(orc.port, "create_session", {})) as { session_id: string };
      const ask = (await rpc(orc.port, "ask_human", {
        session_id: session.session_id,
        question: "Pick one",
        options: ["A", "B"],
        timeout_ms: 30_000,
      })) as { pending: boolean; token: string; watch_url: string | null; surface: { question: string; options?: string[] } };

      expect(ask.pending).toBe(true);
      expect(typeof ask.token).toBe("string");
      // watch_url should be present when bound to 127.0.0.1
      expect(ask.watch_url).toContain("/watch?s=");
      expect(ask.surface.question).toBe("Pick one");
      expect(ask.surface.options).toEqual(["A", "B"]);

      // Simulate the Watch UI POST to /ask/:token/answer
      const ansRes = await fetch(
        `http://127.0.0.1:${orc.port}/ask/${encodeURIComponent(ask.token)}/answer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answer: "A", index: 0 }),
        }
      );
      expect(ansRes.status).toBe(200);
      const ansJson = (await ansRes.json()) as { ok: boolean };
      expect(ansJson.ok).toBe(true);

      // Token should now be consumed — second POST returns 404
      const secondPost = await fetch(
        `http://127.0.0.1:${orc.port}/ask/${encodeURIComponent(ask.token)}/answer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answer: "B" }),
        }
      );
      expect(secondPost.status).toBe(404);

      await rpc(orc.port, "close_session", { session_id: session.session_id });
    }, 30_000);

    it("chat-side path: ask_human → husk_resume({token, answer}) resolves ok", async () => {
      const session = (await rpc(orc.port, "create_session", {})) as { session_id: string };
      const ask = (await rpc(orc.port, "ask_human", {
        session_id: session.session_id,
        question: "Free form question?",
        timeout_ms: 30_000,
      })) as { token: string };

      // Chat side: agent calls resume() to relay the human answer
      const resume = (await rpc(orc.port, "resume", {
        token: ask.token,
        answer: "yes",
      })) as { ok: boolean; kind: string };

      expect(resume.ok).toBe(true);
      expect(resume.kind).toBe("question");

      await rpc(orc.port, "close_session", { session_id: session.session_id });
    }, 30_000);

    it("resume with unknown token returns ok:false, reason:'unknown_token'", async () => {
      const r = (await rpc(orc.port, "resume", {
        token: "definitely-not-a-real-token",
      })) as { ok: boolean; reason?: string };

      expect(r.ok).toBe(false);
      expect(r.reason).toBe("unknown_token");
    }, 15_000);
  });

  // =========================================================================
  // 3. handoff dual-surface
  // =========================================================================
  describe("handoff dual-surface", () => {
    it("Watch-UI path: handoff pauses session; click returns session_paused; POST resume unpauses", async () => {
      const session = (await rpc(orc.port, "create_session", {})) as { session_id: string };

      // Navigate to fixture page so getCurrentUrl() returns a real URL
      await rpc(orc.port, "goto", {
        session_id: session.session_id,
        url: `http://127.0.0.1:${fx.port}/dynamic-form.html`,
      });

      const handoff = (await rpc(orc.port, "handoff", {
        session_id: session.session_id,
        reason: "test_block_captcha",
        suggested_action: "Solve and then resume",
        need_cookies_back: true,
        mode: "paste",
        timeout_ms: 30_000,
      })) as {
        pending: boolean;
        token: string;
        handoff_url: string | null;
        surface: { reason: string; suggested_action?: string; current_url?: string };
      };

      expect(handoff.pending).toBe(true);
      expect(typeof handoff.token).toBe("string");
      expect(handoff.handoff_url).toContain(`/handoff/${handoff.token}`);
      expect(handoff.surface.reason).toBe("test_block_captcha");

      // While paused, click should return ok:false with reason "session_paused"
      // (The JSON-RPC envelope returns {result: {ok:false, reason:"session_paused"}}, not an error)
      const clickWhilePaused = (await rpc(orc.port, "click", {
        session_id: session.session_id,
        intent: "Click me",
      })) as { ok: boolean; reason?: string };
      expect(clickWhilePaused.ok).toBe(false);
      expect(clickWhilePaused.reason).toBe("session_paused");

      // Simulate Watch UI POST to /handoff/:token/resume
      const resumeRes = await fetch(
        `http://127.0.0.1:${orc.port}/handoff/${encodeURIComponent(handoff.token)}/resume`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cookies: [{ name: "test_cookie", value: "test_value", domain: "127.0.0.1" }],
            note: "resumed via Watch UI test",
          }),
        }
      );
      expect(resumeRes.status).toBe(200);
      const resumeJson = (await resumeRes.json()) as { ok: boolean };
      expect(resumeJson.ok).toBe(true);

      // Give the fire-and-forget promise.then() time to importCookies + session.resume
      // The resume is triggered synchronously via resumeHandoff, the .then() fires async
      await new Promise((r) => setTimeout(r, 300));

      // After resume, snapshot should still work (session is no longer paused)
      const snap = (await rpc(orc.port, "snapshot", { session_id: session.session_id })) as { root: unknown };
      expect(snap.root).toBeDefined();

      // After resume, click should NOT return session_paused
      // (may fail for other reasons e.g. element not found, but NOT paused)
      const clickAfterResume = (await rpc(orc.port, "click", {
        session_id: session.session_id,
        intent: "Click me",
      })) as { ok: boolean; reason?: string };
      if (clickAfterResume.ok === false) {
        expect(clickAfterResume.reason).not.toBe("session_paused");
      }

      await rpc(orc.port, "close_session", { session_id: session.session_id });
    }, 60_000);

    it("chat-side path: handoff + husk_resume({token, cookies}) unpauses", async () => {
      const session = (await rpc(orc.port, "create_session", {})) as { session_id: string };
      await rpc(orc.port, "goto", {
        session_id: session.session_id,
        url: `http://127.0.0.1:${fx.port}/dynamic-form.html`,
      });

      const handoff = (await rpc(orc.port, "handoff", {
        session_id: session.session_id,
        reason: "chat_side_test",
        timeout_ms: 30_000,
      })) as { token: string };

      // Chat side: agent calls resume() with cookies to complete handoff
      const resume = (await rpc(orc.port, "resume", {
        token: handoff.token,
        cookies: [{ name: "from_chat", value: "abc", domain: "127.0.0.1" }],
        note: "resumed via chat",
      })) as { ok: boolean; kind: string };

      expect(resume.ok).toBe(true);
      expect(resume.kind).toBe("handoff");

      // Give the fire-and-forget promise.then() time to fire
      await new Promise((r) => setTimeout(r, 300));

      // Subsequent snapshot should succeed — session is no longer paused
      const snap = (await rpc(orc.port, "snapshot", { session_id: session.session_id })) as { root: unknown };
      expect(snap.root).toBeDefined();

      await rpc(orc.port, "close_session", { session_id: session.session_id });
    }, 60_000);

    it("/handoff/:token GET serves HTML with reason + suggested_action + current_url substituted", async () => {
      const session = (await rpc(orc.port, "create_session", {})) as { session_id: string };
      await rpc(orc.port, "goto", {
        session_id: session.session_id,
        url: `http://127.0.0.1:${fx.port}/dynamic-form.html`,
      });

      const handoff = (await rpc(orc.port, "handoff", {
        session_id: session.session_id,
        reason: "captcha_test_substitution",
        suggested_action: "do_the_captcha_thing",
        timeout_ms: 30_000,
      })) as { token: string; handoff_url: string | null };

      expect(handoff.handoff_url).toBeTruthy();

      // Fetch the handoff HTML page
      const r = await fetch(`http://127.0.0.1:${orc.port}/handoff/${encodeURIComponent(handoff.token)}`);
      expect(r.status).toBe(200);
      const html = await r.text();

      // The page should contain the substituted reason, suggested_action, and current_url
      expect(html).toContain("captcha_test_substitution");
      expect(html).toContain("do_the_captcha_thing");
      expect(html).toContain("dynamic-form.html");

      // Clean up: resume then close
      await rpc(orc.port, "resume", { token: handoff.token, note: "test cleanup" });
      await new Promise((r) => setTimeout(r, 100));
      await rpc(orc.port, "close_session", { session_id: session.session_id });
    }, 30_000);

    it("accessing /handoff/:token for an expired/unknown token returns 404", async () => {
      const r = await fetch(`http://127.0.0.1:${orc.port}/handoff/no-such-token-ever`);
      expect(r.status).toBe(404);
    }, 15_000);
  });
});
