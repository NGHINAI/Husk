import { describe, it, expect, vi } from "vitest";
import { HumanIOBus } from "../../src/hitl/bus.js";
import { WatchBus } from "../../src/watch/sse.js";
import { METHODS } from "../../src/http/methods.js";

describe("resume RPC method", () => {
  const makeCtx = () => ({
    humanIO: new HumanIOBus(),
    watchBus: new WatchBus(),
    host: "127.0.0.1",
    portRef: { value: 7777 },
    sessions: { get: () => ({}) },
  });

  it("resolves a pending question with an answer (chat-side relay)", async () => {
    const ctx = makeCtx();
    const { token, promise } = ctx.humanIO.askQuestion("sess1", { question: "Pick" }, 10_000);
    const r = await METHODS.resume(ctx as any, { token, answer: "Acme" });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("question");
    const resolved = await promise;
    expect(resolved.answer).toBe("Acme");
  });

  it("resolves a pending handoff with cookies (chat-side handoff completion)", async () => {
    const ctx = makeCtx();
    const { token, promise } = ctx.humanIO.startHandoff("sess1", { reason: "x" }, 10_000);
    const r = await METHODS.resume(ctx as any, {
      token,
      cookies: [{ name: "s", value: "v" }],
      note: "done in chat",
    });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("handoff");
    const resolved = await promise;
    expect(resolved.resumed).toBe(true);
    expect(resolved.cookies_imported).toBe(1);
  });

  it("returns ok:false with unknown_token for tokens that don't exist", async () => {
    const ctx = makeCtx();
    const r = await METHODS.resume(ctx as any, { token: "ghost" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unknown_token");
  });

  it("infers kind from which bus has the token (question vs handoff)", async () => {
    const ctx = makeCtx();
    const { token: qToken } = ctx.humanIO.askQuestion("sess1", { question: "?" }, 10_000);
    const { token: hToken } = ctx.humanIO.startHandoff("sess2", { reason: "x" }, 10_000);
    const rQ = await METHODS.resume(ctx as any, { token: qToken, answer: "hi" });
    const rH = await METHODS.resume(ctx as any, { token: hToken, note: "done" });
    expect(rQ.kind).toBe("question");
    expect(rH.kind).toBe("handoff");
  });

  it("emits a resolved WatchEvent for the right session", async () => {
    const ctx = makeCtx();
    const { token } = ctx.humanIO.askQuestion("sess1", { question: "?" }, 10_000);
    const seen: any[] = [];
    ctx.watchBus.subscribe("sess1", (e) => seen.push(e));
    await METHODS.resume(ctx as any, { token, answer: "x" });
    expect(seen).toContainEqual(expect.objectContaining({
      kind: "resolved",
      token,
      kind_resolved: "question",
    }));
  });

  it("question resume with options index instead of answer text", async () => {
    const ctx = makeCtx();
    const { token, promise } = ctx.humanIO.askQuestion("sess1", { question: "Pick", options: ["A", "B"] }, 10_000);
    await METHODS.resume(ctx as any, { token, index: 1 });
    const resolved = await promise;
    expect(resolved.index).toBe(1);
  });
});
