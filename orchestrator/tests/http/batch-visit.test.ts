import { describe, expect, it, vi } from "vitest";
import { METHODS } from "../../src/http/methods.js";
import { SessionManager } from "../../src/session/manager.js";
import type { Session } from "../../src/session/session.js";

interface CallTrace { method: string; args: unknown[]; }

function makeCtx(opts: {
  perUrl?: (url: string) => Promise<{ snapshot?: any; text?: string | null; error?: string }>;
} = {}) {
  const traces: CallTrace[] = [];
  let createCalls = 0;
  let closeCalls = 0;
  const sm = new SessionManager(async () => {
    createCalls++;
    let lastUrl = "";
    return {
      goto: async (url: string) => { lastUrl = url; traces.push({ method: "goto", args: [url] }); },
      snapshot: async () => {
        traces.push({ method: "snapshot", args: [] });
        const r = await opts.perUrl?.(lastUrl);
        if (r?.error) throw new Error(r.error);
        return r?.snapshot ?? { v: 1, url: lastUrl, count: 1, root: { i: "r", r: "RootWebArea", n: "", s: ["v"] } };
      },
      extract: async (q: any) => {
        traces.push({ method: "extract", args: [q] });
        const r = await opts.perUrl?.(lastUrl);
        if (r?.error) throw new Error(r.error);
        return r?.text ?? null;
      },
      close: async () => { closeCalls++; },
    } as unknown as Session;
  });
  return {
    ctx: { sessions: sm, version: "0.0.0", vault: {} as any, credentials: {} as any },
    traces,
    createCounts: () => createCalls,
    closeCounts: () => closeCalls,
  };
}

describe("HTTP batch_visit", () => {
  it("creates one session per URL and visits in parallel", async () => {
    const t = makeCtx();
    const urls = ["https://a.test/", "https://b.test/", "https://c.test/"];
    const r = (await METHODS.batch_visit({ urls }, t.ctx)) as { results: Array<{ url: string; ok: boolean }> };
    expect(r.results.length).toBe(3);
    expect(r.results.every((x) => x.ok)).toBe(true);
    expect(t.createCounts()).toBe(3);
    expect(t.closeCounts()).toBe(3);
  });

  it("returns snapshot per URL when no extract supplied", async () => {
    const t = makeCtx({
      perUrl: async (url) => ({ snapshot: { v: 1, url, count: 1, root: { i: "x", r: "RootWebArea", n: url, s: ["v"] } } }),
    });
    const r = (await METHODS.batch_visit({ urls: ["https://x/"] }, t.ctx)) as { results: any[] };
    expect(r.results[0].snapshot).toBeDefined();
    expect(r.results[0].text).toBeUndefined();
  });

  it("returns extracted text per URL when extract.css supplied", async () => {
    const t = makeCtx({
      perUrl: async (url) => ({ text: `extracted from ${url}` }),
    });
    const r = (await METHODS.batch_visit({
      urls: ["https://a/", "https://b/"],
      extract: { css: ".f4.my-3" },
    }, t.ctx)) as { results: any[] };
    expect(r.results[0].text).toBe("extracted from https://a/");
    expect(r.results[1].text).toBe("extracted from https://b/");
    expect(r.results[0].snapshot).toBeUndefined();
  });

  it("isolates per-URL failures: one bad URL doesn't break the rest", async () => {
    const t = makeCtx({
      perUrl: async (url) => {
        if (url === "https://broken/") return { error: "ECONNREFUSED" };
        return { text: "ok" };
      },
    });
    const r = (await METHODS.batch_visit({
      urls: ["https://a/", "https://broken/", "https://c/"],
      extract: { css: ".x" },
    }, t.ctx)) as { results: Array<{ url: string; ok: boolean; error?: string }> };
    expect(r.results.length).toBe(3);
    expect(r.results[0].ok).toBe(true);
    expect(r.results[1].ok).toBe(false);
    expect(r.results[1].error).toContain("ECONNREFUSED");
    expect(r.results[2].ok).toBe(true);
  });

  it("close() is called even when a URL throws", async () => {
    const t = makeCtx({
      perUrl: async (url) => ({ error: `boom ${url}` }),
    });
    await METHODS.batch_visit({ urls: ["https://a/", "https://b/"] }, t.ctx);
    expect(t.closeCounts()).toBe(2);
  });

  it("preserves URL order in the result array", async () => {
    const t = makeCtx({
      perUrl: async (url) => {
        if (url.endsWith("0")) await new Promise((r) => setTimeout(r, 30));
        return { text: url };
      },
    });
    const urls = ["https://a0/", "https://b/", "https://c/", "https://d0/"];
    const r = (await METHODS.batch_visit({ urls, extract: { css: ".x" } }, t.ctx)) as { results: any[] };
    expect(r.results.map((x) => x.url)).toEqual(urls);
  });

  it("results array is empty when urls array is empty", async () => {
    const t = makeCtx();
    const r = (await METHODS.batch_visit({ urls: [] }, t.ctx)) as { results: any[] };
    expect(r.results).toEqual([]);
    expect(t.createCounts()).toBe(0);
  });
});
