import { describe, it, expect, vi } from "vitest";
import { runSeamlessHandoff } from "../../src/handoff/seamless-orchestrator.js";
import type { ImportingSession } from "../../src/handoff/cookie-sync.js";

// Mock the dependency boundary: T5 takes injectable factories so tests don't actually spawn Chrome.

const makeMockSession = (): ImportingSession => ({
  importCookies: vi.fn().mockResolvedValue(0),
});

describe("runSeamlessHandoff", () => {
  it("returns chrome_not_found when findChrome returns null", async () => {
    const result = await runSeamlessHandoff({
      session: makeMockSession(),
      targetUrl: "https://linkedin.com/login",
      timeoutMs: 5000,
      token: "tok-1",
      huskPort: 7777,
      // Injected deps:
      findChrome: () => null,
      spawnChrome: vi.fn(),
      connectToChrome: vi.fn(),
      createProfileDir: vi.fn(),
      cleanupProfileDir: vi.fn(),
    });
    expect(result.resumed).toBe(false);
    expect(result.reason).toBe("chrome_not_found");
    expect(result.cookies_imported).toBe(0);
  });

  it("completes via URL change: spawn → watch → navigate-off-login → sync → cleanup", async () => {
    const closeWatcher = vi.fn();
    const killChild = vi.fn();
    const cleanupProfileDir = vi.fn();
    const navHandlers: Array<(url: string) => void> = [];

    const watcher = {
      onNavigation: (fn: (url: string) => void) => { navHandlers.push(fn); return () => {}; },
      injectOverlayScript: vi.fn().mockResolvedValue(undefined),
      getAllCookies: vi.fn().mockResolvedValue([
        { name: "li_at", value: "abc", domain: ".linkedin.com", path: "/" },
      ]),
      close: closeWatcher,
    };

    const child = { kill: killChild };
    const spawned = {
      child,
      port: 9223,
      profileDir: "/tmp/husk-handoff-x",
      whenReady: async () => undefined,
    };

    const session = makeMockSession();
    (session.importCookies as any).mockResolvedValue(1);

    const promise = runSeamlessHandoff({
      session,
      targetUrl: "https://linkedin.com/login",
      timeoutMs: 5000,
      token: "tok-2",
      huskPort: 7777,
      findChrome: () => "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      spawnChrome: vi.fn().mockReturnValue(spawned),
      connectToChrome: vi.fn().mockResolvedValue(watcher),
      createProfileDir: vi.fn().mockResolvedValue("/tmp/husk-handoff-x"),
      cleanupProfileDir,
    });

    // Wait one tick to let the orchestrator wire up navigation handlers
    await new Promise((r) => setTimeout(r, 10));

    // Simulate Chrome navigating away from /login → triggers completion
    expect(navHandlers.length).toBe(1);
    navHandlers[0]("https://linkedin.com/feed");

    const result = await promise;
    expect(result.resumed).toBe(true);
    expect(result.cookies_imported).toBe(1);
    expect(session.importCookies).toHaveBeenCalled();
    expect(closeWatcher).toHaveBeenCalled();
    expect(killChild).toHaveBeenCalled();
    expect(cleanupProfileDir).toHaveBeenCalledWith("/tmp/husk-handoff-x");
  });

  it("returns timeout when navigation never moves off login", async () => {
    const watcher = {
      onNavigation: () => () => {},
      injectOverlayScript: vi.fn().mockResolvedValue(undefined),
      getAllCookies: vi.fn(),
      close: vi.fn(),
    };
    const child = { kill: vi.fn() };
    const result = await runSeamlessHandoff({
      session: makeMockSession(),
      targetUrl: "https://linkedin.com/login",
      timeoutMs: 100,
      token: "tok-3",
      huskPort: 7777,
      findChrome: () => "/chrome",
      spawnChrome: vi.fn().mockReturnValue({ child, port: 9224, profileDir: "/tmp/x", whenReady: async () => {} }),
      connectToChrome: vi.fn().mockResolvedValue(watcher),
      createProfileDir: vi.fn().mockResolvedValue("/tmp/x"),
      cleanupProfileDir: vi.fn(),
    });
    expect(result.resumed).toBe(false);
    expect(result.reason).toBe("timeout");
    expect(watcher.close).toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalled();
  });

  it("completes via manual button signal (manualDone callback)", async () => {
    const watcher = {
      onNavigation: () => () => {},
      injectOverlayScript: vi.fn().mockResolvedValue(undefined),
      getAllCookies: vi.fn().mockResolvedValue([{ name: "x", value: "y", domain: ".linkedin.com", path: "/" }]),
      close: vi.fn(),
    };
    const child = { kill: vi.fn() };
    const session = makeMockSession();
    (session.importCookies as any).mockResolvedValue(1);

    // T5 needs to expose a way for the caller (T6) to signal "manual done" — return a handle.
    let manualDoneTrigger: (() => void) | null = null;

    const promise = runSeamlessHandoff({
      session,
      targetUrl: "https://linkedin.com/login",
      timeoutMs: 5000,
      token: "tok-4",
      huskPort: 7777,
      findChrome: () => "/chrome",
      spawnChrome: vi.fn().mockReturnValue({ child, port: 9225, profileDir: "/tmp/y", whenReady: async () => {} }),
      connectToChrome: vi.fn().mockResolvedValue(watcher),
      createProfileDir: vi.fn().mockResolvedValue("/tmp/y"),
      cleanupProfileDir: vi.fn(),
      onManualDoneHandle: (trigger) => { manualDoneTrigger = trigger; },
    });

    // After a moment, the orchestrator has called onManualDoneHandle with a callback
    await new Promise((r) => setTimeout(r, 10));
    expect(manualDoneTrigger).not.toBeNull();
    manualDoneTrigger!();

    const result = await promise;
    expect(result.resumed).toBe(true);
    expect(result.cookies_imported).toBe(1);
  });

  it("cleans up even when sync throws", async () => {
    const watcher = {
      onNavigation: (fn: (url: string) => void) => { setTimeout(() => fn("https://linkedin.com/feed"), 5); return () => {}; },
      injectOverlayScript: vi.fn().mockResolvedValue(undefined),
      getAllCookies: vi.fn().mockRejectedValue(new Error("CDP error")),
      close: vi.fn(),
    };
    const child = { kill: vi.fn() };
    const cleanupProfileDir = vi.fn();
    const result = await runSeamlessHandoff({
      session: makeMockSession(),
      targetUrl: "https://linkedin.com/login",
      timeoutMs: 5000,
      token: "tok-5",
      huskPort: 7777,
      findChrome: () => "/chrome",
      spawnChrome: vi.fn().mockReturnValue({ child, port: 9226, profileDir: "/tmp/z", whenReady: async () => {} }),
      connectToChrome: vi.fn().mockResolvedValue(watcher),
      createProfileDir: vi.fn().mockResolvedValue("/tmp/z"),
      cleanupProfileDir,
    });
    expect(result.cookies_imported).toBe(0);
    expect(watcher.close).toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalled();
    expect(cleanupProfileDir).toHaveBeenCalled();
  });

  it("injects the overlay button script (for manual fallback)", async () => {
    const watcher = {
      onNavigation: () => () => {},
      injectOverlayScript: vi.fn().mockResolvedValue(undefined),
      getAllCookies: vi.fn(),
      close: vi.fn(),
    };
    const child = { kill: vi.fn() };
    const promise = runSeamlessHandoff({
      session: makeMockSession(),
      targetUrl: "https://x.com/login",
      timeoutMs: 100,  // short timeout — we just want to verify injection happens
      token: "tok-6",
      huskPort: 7777,
      findChrome: () => "/chrome",
      spawnChrome: vi.fn().mockReturnValue({ child, port: 9227, profileDir: "/tmp/q", whenReady: async () => {} }),
      connectToChrome: vi.fn().mockResolvedValue(watcher),
      createProfileDir: vi.fn().mockResolvedValue("/tmp/q"),
      cleanupProfileDir: vi.fn(),
    });
    await promise;
    expect(watcher.injectOverlayScript).toHaveBeenCalled();
    const scriptArg = watcher.injectOverlayScript.mock.calls[0][0] as string;
    expect(scriptArg).toContain("tok-6");
    expect(scriptArg).toContain("7777");
  });
});
