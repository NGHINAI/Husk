import { describe, it, expect, vi } from "vitest";
import { runScrollUntil } from "../../src/session/scroll-until.js";

describe("runScrollUntil", () => {
  it("resolves immediately when condition already true (0 scrolls)", async () => {
    const session = {
      snapshot: vi.fn().mockResolvedValue({
        url: "/",
        nodes: [{ i: "x", r: "button", n: "Load more" }],
      }),
      runtimeEval: vi.fn(),
      scroll: vi.fn(),
    };
    const r = await runScrollUntil(session as any, {
      until: { text: "Load more" },
      max_scrolls: 5,
    });
    expect(r.ok).toBe(true);
    expect(r.scrolls).toBe(0);
    expect(r.condition_met).toBe("text");
    expect(session.scroll).not.toHaveBeenCalled();
  });

  it("scrolls until condition becomes true", async () => {
    let pageState = "loading";
    const session = {
      snapshot: vi.fn().mockImplementation(async () => ({
        url: "/",
        nodes: pageState === "loaded"
          ? [{ i: "x", r: "heading", n: "Welcome" }]
          : [{ i: "y", r: "text", n: "loading..." }],
      })),
      runtimeEval: vi.fn(),
      scroll: vi.fn().mockImplementation(async () => {
        if (session.scroll.mock.calls.length >= 3) pageState = "loaded";
      }),
    };
    const r = await runScrollUntil(session as any, {
      until: { text: "Welcome" },
      max_scrolls: 10,
    });
    expect(r.ok).toBe(true);
    expect(r.scrolls).toBe(3);
  });

  it("stops at max_scrolls if condition never met", async () => {
    const session = {
      snapshot: vi.fn().mockResolvedValue({ url: "/", nodes: [] }),
      runtimeEval: vi.fn(),
      scroll: vi.fn(),
    };
    const r = await runScrollUntil(session as any, {
      until: { text: "never" },
      max_scrolls: 3,
    });
    expect(r.ok).toBe(false);
    expect(r.scrolls).toBe(3);
    expect(r.condition_met).toBeUndefined();
  });

  it("uses default max_scrolls=20 if not provided", async () => {
    const session = {
      snapshot: vi.fn().mockResolvedValue({ url: "/", nodes: [] }),
      runtimeEval: vi.fn(),
      scroll: vi.fn(),
    };
    const r = await runScrollUntil(session as any, { until: { text: "never" } });
    expect(r.scrolls).toBe(20);
  });

  it("passes scroll_amount_px to session.scroll (default 800)", async () => {
    const session = {
      snapshot: vi.fn().mockResolvedValue({ url: "/", nodes: [] }),
      runtimeEval: vi.fn(),
      scroll: vi.fn(),
    };
    await runScrollUntil(session as any, { until: { text: "never" }, max_scrolls: 1 });
    expect(session.scroll).toHaveBeenCalledWith(null, "down", 800);
  });

  it("respects custom scroll_amount_px", async () => {
    const session = {
      snapshot: vi.fn().mockResolvedValue({ url: "/", nodes: [] }),
      runtimeEval: vi.fn(),
      scroll: vi.fn(),
    };
    await runScrollUntil(session as any, { until: { text: "never" }, max_scrolls: 1, scroll_amount_px: 400 });
    expect(session.scroll).toHaveBeenCalledWith(null, "down", 400);
  });

  it("throws when no until condition provided", async () => {
    const session = { snapshot: vi.fn(), runtimeEval: vi.fn(), scroll: vi.fn() };
    await expect(runScrollUntil(session as any, { max_scrolls: 5 } as never)).rejects.toThrow(/until/i);
  });
});
