/**
 * T8 wire-up tests: Session.intend() + HTTP `intend` method (smoke).
 *
 * Goals:
 *   1. session.intend() returns unknown_site Outcome when intention not in store.
 *   2. session.intend() returns a successful Outcome when a trivial intention IS in store.
 *   3. METHODS.intend routes through to session.intend (smoke test via mock session).
 *
 * No real lightpanda needed — the compiler runs entirely against a mock SessionAdapter
 * built from a fake session, and the SQLite store runs in a temp directory.
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Session } from "../../src/session/session.js";
import { SiteGraphCache } from "../../src/cache/site-graph.js";
import { IntentionStore } from "../../src/cognition/intention-store.js";
import type { Intention } from "../../src/cognition/intention-types.js";
import { METHODS } from "../../src/http/methods.js";
import type { MethodContext } from "../../src/http/methods.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeCdp(url: string = "https://test.example.com/home") {
  return {
    send: async (method: string, _params?: Record<string, unknown>) => {
      if (method === "Accessibility.getFullAXTree") {
        // Return a minimal AX tree in the exact format transformAxTree expects.
        return {
          nodes: [
            {
              nodeId: "1",
              role: { type: "role", value: "RootWebArea" },
              name: { type: "computedString", value: "Test Page" },
              properties: [],
              childIds: [],
            },
          ],
        };
      }
      if (method === "Page.navigate") return { frameId: "f1" };
      if (method === "Page.enable") return {};
      if (method === "Network.enable") return {};
      if (method === "Accessibility.enable") return {};
      if (method === "Runtime.enable") return {};
      if (method === "Log.enable") return {};
      // extractMeta / extractForms / shadow walker / location queries — return null
      // so their try-catch fallbacks kick in and return safe defaults.
      return null;
    },
    close: async () => {},
    on: (_event: string, _fn: unknown) => {},
    off: (_event: string, _fn: unknown) => {},
  };
}

type InjectedSession = Session & { siteGraph: SiteGraphCache | null };

function makeSession(url: string = "https://test.example.com/home"): InjectedSession {
  const cdp = makeFakeCdp(url);
  const s = (Session as unknown as {
    fromInjected: (i: { engine: { close: () => Promise<void> }; cdp: typeof cdp; sessionId: string; url: string }) => Session;
  }).fromInjected({
    engine: { close: async () => {} },
    cdp,
    sessionId: "test-sess",
    url,
  });
  return s as InjectedSession;
}

function makeIntention(site: string, name: string): Intention {
  return {
    site,
    name,
    args_schema: { type: "object" },
    // No requires_state — compiler skips state-graph traversal entirely.
    steps: [],
    // Verify: URL must match "/home" — current URL is "https://test.example.com/home".
    verify: [{ type: "url", pattern: "/home", description: "on home page" }],
    failure_modes: [],
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tempDirs = [];
});

function makeTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "husk-t8-"));
  tempDirs.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Session.intend — unknown_site path", () => {
  it("returns unknown_site Outcome when no siteGraph is wired", async () => {
    const session = makeSession();
    // fromInjected never wires siteGraph (it's null)
    const outcome = await session.intend({ intention_name: "do_something" });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("unknown_site");
    expect(outcome.intention).toBe("do_something");
    expect(outcome.state_before).toBeNull();
    expect(outcome.evidence).toEqual([]);
    expect(outcome.steps_observed).toEqual([]);
  });

  it("returns unknown_site Outcome when siteGraph is present but intention not in store", async () => {
    const dir = makeTempDir();
    const cache = new SiteGraphCache({ cacheDir: dir });
    const session = makeSession();
    // Inject the siteGraph directly.
    (session as unknown as { siteGraph: SiteGraphCache }).siteGraph = cache;

    const outcome = await session.intend({ intention_name: "nonexistent_intention", site: "test.example.com" });
    cache.close();

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("unknown_site");
    expect(outcome.intention).toBe("nonexistent_intention");
    expect(outcome.reason_detail).toContain("nonexistent_intention");
    expect(outcome.reason_detail).toContain("test.example.com");
  });
});

describe("Session.intend — success path", () => {
  it("returns successful Outcome when a trivial intention is in the store and verify passes", async () => {
    const dir = makeTempDir();
    const cache = new SiteGraphCache({ cacheDir: dir });

    // Register a trivial intention: empty steps, url-pattern verify that matches current URL.
    const store = new IntentionStore(cache.db);
    store.upsert(makeIntention("test.example.com", "noop_home"));

    const session = makeSession("https://test.example.com/home");
    (session as unknown as { siteGraph: SiteGraphCache }).siteGraph = cache;

    const outcome = await session.intend({ intention_name: "noop_home", site: "test.example.com" });
    cache.close();

    // The compiler should succeed: no steps, verify passes (url matches "/home").
    expect(outcome.ok).toBe(true);
    expect(outcome.intention).toBe("noop_home");
    expect(outcome.evidence).toHaveLength(1);
    expect(outcome.evidence[0].passed).toBe(true);
  });

  it("returns verify_failed Outcome when verify pattern does not match current URL", async () => {
    const dir = makeTempDir();
    const cache = new SiteGraphCache({ cacheDir: dir });

    const badIntention: Intention = {
      ...makeIntention("test.example.com", "check_admin"),
      verify: [{ type: "url", pattern: "/admin", description: "on admin page" }],
    };
    const store = new IntentionStore(cache.db);
    store.upsert(badIntention);

    const session = makeSession("https://test.example.com/home");
    (session as unknown as { siteGraph: SiteGraphCache }).siteGraph = cache;

    const outcome = await session.intend({ intention_name: "check_admin", site: "test.example.com" });
    cache.close();

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("verify_failed");
    expect(outcome.evidence[0].passed).toBe(false);
  });

  it("derives site from URL hostname when site param not supplied", async () => {
    const dir = makeTempDir();
    const cache = new SiteGraphCache({ cacheDir: dir });

    // Session URL: "https://www.example.org/page" → site should be "example.org" (www stripped)
    const store = new IntentionStore(cache.db);
    store.upsert({
      ...makeIntention("example.org", "ping"),
      verify: [{ type: "url", pattern: "/page", description: "on /page" }],
    });

    const session = makeSession("https://www.example.org/page");
    (session as unknown as { siteGraph: SiteGraphCache }).siteGraph = cache;

    const outcome = await session.intend({ intention_name: "ping" });
    cache.close();

    expect(outcome.ok).toBe(true);
    expect(outcome.intention).toBe("ping");
  });
});

describe("METHODS.intend — smoke test (HTTP method routes to session.intend)", () => {
  it("routes through to session.intend and returns an Outcome", async () => {
    const dir = makeTempDir();
    const cache = new SiteGraphCache({ cacheDir: dir });

    const store = new IntentionStore(cache.db);
    store.upsert(makeIntention("test.example.com", "smoke_test"));

    const session = makeSession("https://test.example.com/home");
    (session as unknown as { siteGraph: SiteGraphCache }).siteGraph = cache;

    // Build a minimal MethodContext with a fake sessions map.
    const ctx = {
      sessions: {
        get: (_id: string) => session,
        activeCount: () => 1,
      },
      version: "test",
      vault: {} as unknown as MethodContext["vault"],
      credentials: {} as unknown as MethodContext["credentials"],
    } as unknown as MethodContext;

    const result = await METHODS.intend(
      { session_id: "test-sess", intention_name: "smoke_test", site: "test.example.com" },
      ctx,
    );
    cache.close();

    // Should be a valid Outcome shape — the compiler ran.
    expect(result).toBeDefined();
    expect(typeof result.ok).toBe("boolean");
    expect(result.intention).toBe("smoke_test");
    expect(Array.isArray(result.evidence)).toBe(true);
  });
});
