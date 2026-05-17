import { describe, it, expect } from "vitest";
import { HistoryBuffer } from "../../src/session/history-buffer.js";

describe("HistoryBuffer", () => {
  it("records actions with verb, target_name, ok, ts", () => {
    const buf = new HistoryBuffer(10);
    buf.add({ verb: "click", target_name: "Sign in", ok: true, ts: 1 });
    buf.add({ verb: "type", target_name: "Email", ok: true, ts: 2 });
    const recent = buf.recent();
    expect(recent).toHaveLength(2);
    expect(recent[0]).toEqual({ verb: "click", target_name: "Sign in", ok: true, ts: 1 });
    expect(recent[1].verb).toBe("type");
  });

  it("evicts oldest past max size (FIFO)", () => {
    const buf = new HistoryBuffer(3);
    for (let i = 0; i < 5; i++) buf.add({ verb: "click", target_name: `t${i}`, ok: true, ts: i });
    expect(buf.recent().map((h) => h.target_name)).toEqual(["t2", "t3", "t4"]);
  });

  it("returns fresh array (mutation safe)", () => {
    const buf = new HistoryBuffer(10);
    buf.add({ verb: "click", target_name: "x", ok: true, ts: 1 });
    const r = buf.recent();
    r.push({ verb: "type", target_name: "y", ok: false, ts: 2 });
    expect(buf.recent()).toHaveLength(1);
  });

  it("includes optional url_after field", () => {
    const buf = new HistoryBuffer(10);
    buf.add({ verb: "goto", target_name: null, ok: true, ts: 1, url_after: "https://example.com" });
    expect(buf.recent()[0].url_after).toBe("https://example.com");
  });

  it("clear() empties the buffer", () => {
    const buf = new HistoryBuffer(10);
    buf.add({ verb: "click", target_name: "x", ok: true, ts: 1 });
    buf.clear();
    expect(buf.recent()).toEqual([]);
  });
});
