import { describe, it, expect } from "vitest";
import { ConsoleBuffer } from "../../src/session/console-buffer.js";

describe("ConsoleBuffer", () => {
  it("records messages with level + text + ts", () => {
    const buf = new ConsoleBuffer(50);
    buf.add({ level: "error", text: "TypeError: x is undefined", ts: 1 });
    buf.add({ level: "warn", text: "deprecated API", ts: 2 });
    const recent = buf.recent();
    expect(recent).toHaveLength(2);
    expect(recent[0]).toEqual({ level: "error", text: "TypeError: x is undefined", ts: 1 });
    expect(recent[1].level).toBe("warn");
  });

  it("evicts oldest past max size (FIFO)", () => {
    const buf = new ConsoleBuffer(2);
    for (let i = 0; i < 5; i++) buf.add({ level: "log", text: `msg ${i}`, ts: i });
    expect(buf.recent().map((m) => m.text)).toEqual(["msg 3", "msg 4"]);
  });

  it("returns a fresh array (caller can mutate without affecting buffer)", () => {
    const buf = new ConsoleBuffer(10);
    buf.add({ level: "log", text: "a", ts: 1 });
    const r1 = buf.recent();
    r1.push({ level: "log", text: "b", ts: 2 });
    expect(buf.recent()).toHaveLength(1);  // unaffected
  });

  it("clear() empties the buffer", () => {
    const buf = new ConsoleBuffer(10);
    buf.add({ level: "log", text: "a", ts: 1 });
    buf.clear();
    expect(buf.recent()).toEqual([]);
  });
});
