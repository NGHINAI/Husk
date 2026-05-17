import { describe, it, expect } from "vitest";
import { NetworkBuffer } from "../../src/session/network-buffer.js";

describe("NetworkBuffer", () => {
  it("records request → response pairs with duration_ms and content_type", () => {
    const buf = new NetworkBuffer(10);
    buf.onRequest("req1", { url: "https://api.x/1", method: "GET", startedAt: 100 });
    buf.onResponse("req1", { status: 200, mimeType: "application/json", completedAt: 200 });
    const recent = buf.recent();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      url: "https://api.x/1",
      method: "GET",
      status: 200,
      duration_ms: 100,
      content_type: "application/json",
    });
  });

  it("respects max size (oldest evicted in FIFO order)", () => {
    const buf = new NetworkBuffer(2);
    buf.onRequest("a", { url: "a", method: "GET", startedAt: 0 });
    buf.onResponse("a", { status: 200, mimeType: "text/html", completedAt: 1 });
    buf.onRequest("b", { url: "b", method: "GET", startedAt: 1 });
    buf.onResponse("b", { status: 200, mimeType: "text/html", completedAt: 2 });
    buf.onRequest("c", { url: "c", method: "GET", startedAt: 2 });
    buf.onResponse("c", { status: 200, mimeType: "text/html", completedAt: 3 });
    expect(buf.recent().map((r) => r.url)).toEqual(["b", "c"]);
  });

  it("records unmatched requests as in-flight (no status, no duration_ms)", () => {
    const buf = new NetworkBuffer(10);
    buf.onRequest("pending", { url: "https://api.x/slow", method: "POST", startedAt: 100 });
    const recent = buf.recent();
    expect(recent).toHaveLength(1);
    expect(recent[0].status).toBeUndefined();
    expect(recent[0].duration_ms).toBeUndefined();
  });

  it("handles loadingFailed (status 0, sets duration_ms)", () => {
    const buf = new NetworkBuffer(10);
    buf.onRequest("f1", { url: "https://x/fail", method: "GET", startedAt: 50 });
    buf.onFailed("f1", { completedAt: 75 });
    const recent = buf.recent();
    expect(recent[0].status).toBe(0);
    expect(recent[0].duration_ms).toBe(25);
  });

  it("urls() returns recent URLs in order (for signature use)", () => {
    const buf = new NetworkBuffer(10);
    buf.onRequest("a", { url: "a", method: "GET", startedAt: 0 });
    buf.onRequest("b", { url: "b", method: "GET", startedAt: 1 });
    expect(buf.urls()).toEqual(["a", "b"]);
  });

  it("response without matching request is a no-op", () => {
    const buf = new NetworkBuffer(10);
    buf.onResponse("ghost", { status: 200, mimeType: "text/html", completedAt: 100 });
    expect(buf.recent()).toEqual([]);
  });
});
