import { describe, it, expect, vi } from "vitest";
import { runPaginate } from "../../src/session/paginate.js";

describe("runPaginate", () => {
  it("collects N pages by clicking next between each extract", async () => {
    const session = {
      extractOnce: vi.fn()
        .mockResolvedValueOnce({ title: "Page 1", items: ["a", "b"] })
        .mockResolvedValueOnce({ title: "Page 2", items: ["c", "d"] })
        .mockResolvedValueOnce({ title: "Page 3", items: ["e", "f"] }),
      click: vi.fn().mockResolvedValue({ ok: true }),
      waitFor: vi.fn().mockResolvedValue({ ok: true }),
    };
    const r = await runPaginate(session as any, {
      next: { intent: "Next page" },
      max_pages: 3,
    });
    expect(r.total_pages).toBe(3);
    expect(r.pages[0]).toEqual({ title: "Page 1", items: ["a", "b"] });
    expect(r.stopped_reason).toBe("max_pages");
    // click and waitFor each happen between extracts: extract → click → waitFor → extract → ...
    expect(session.click).toHaveBeenCalledTimes(2);
    expect(session.waitFor).toHaveBeenCalledTimes(2);
  });

  it("stops when click(next) fails (next disappeared at last page)", async () => {
    const session = {
      extractOnce: vi.fn().mockResolvedValue({ items: [] }),
      click: vi.fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false, reason: "no_match", candidates: [] }),
      waitFor: vi.fn().mockResolvedValue({ ok: true }),
    };
    const r = await runPaginate(session as any, {
      next: { intent: "Next" },
      max_pages: 10,
    });
    expect(r.total_pages).toBe(2);
    expect(r.stopped_reason).toBe("next_disappeared");
  });

  it("stops when stop_when condition matches", async () => {
    const session = {
      extractOnce: vi.fn().mockResolvedValue({ items: [] }),
      click: vi.fn().mockResolvedValue({ ok: true }),
      waitFor: vi.fn()
        .mockResolvedValueOnce({ ok: false })  // stop_when check after page 1
        .mockResolvedValueOnce({ ok: true, condition_met: "text" }),  // stop_when matches after page 2
    };
    const r = await runPaginate(session as any, {
      next: { intent: "Next" },
      max_pages: 10,
      stop_when: { text: "End of results" },
    });
    expect(r.total_pages).toBe(2);
    expect(r.stopped_reason).toBe("stop_when");
  });

  it("returns empty when max_pages is 0", async () => {
    const session = { extractOnce: vi.fn(), click: vi.fn(), waitFor: vi.fn() };
    const r = await runPaginate(session as any, {
      next: { intent: "Next" },
      max_pages: 0,
    });
    expect(r.pages).toEqual([]);
    expect(r.total_pages).toBe(0);
    expect(r.stopped_reason).toBe("max_pages");
    expect(session.extractOnce).not.toHaveBeenCalled();
  });

  it("uses default max_pages=10 when not provided", async () => {
    const session = {
      extractOnce: vi.fn().mockResolvedValue({ items: [] }),
      click: vi.fn().mockResolvedValue({ ok: true }),
      waitFor: vi.fn().mockResolvedValue({ ok: false }),
    };
    const r = await runPaginate(session as any, { next: { intent: "Next" } });
    expect(r.total_pages).toBe(10);
  });
});
