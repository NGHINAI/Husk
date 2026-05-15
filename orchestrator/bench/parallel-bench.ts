import { Session } from "../src/session/session.js";
import { EnginePool } from "../src/engine/pool.js";
import { SessionManager } from "../src/session/manager.js";
import { locateLightpanda } from "../src/engine/binary.js";
import { batchVisit } from "../src/http/batch.js";
import type { MethodContext } from "../src/http/methods.js";

// A small, reliable set of public URLs that lightpanda renders cleanly.
// Repeated to reach the target N.
const SEED_URLS = [
  "https://example.com/",
  "https://news.ycombinator.com/",
  "https://github.com/freeCodeCamp/freeCodeCamp",
  "https://github.com/sindresorhus/awesome",
  "https://github.com/public-apis/public-apis",
  "https://github.com/donnemartin/system-design-primer",
  "https://github.com/trekhleb/javascript-algorithms",
  "https://github.com/TheAlgorithms/Python",
  "https://github.com/facebook/react",
  "https://github.com/vuejs/vue",
];

type Mode = "pool" | "batch" | "batch-extract";

interface Result {
  idx: number;
  url: string;
  ok: boolean;
  count?: number;
  payloadBytes?: number;
  ms?: number;
  error?: string;
}

async function main() {
  const binary = await locateLightpanda();
  const N = parseInt(process.env.BENCH_N ?? "50", 10);
  const POOL_MAX = parseInt(process.env.BENCH_POOL_MAX ?? String(Math.min(50, N)), 10);
  const POOL_MIN = parseInt(process.env.BENCH_POOL_MIN ?? "4", 10);
  const MODE: Mode = (process.env.BENCH_MODE ?? "pool") as Mode;
  const urls = Array.from({ length: N }, (_, i) => SEED_URLS[i % SEED_URLS.length]);

  console.log(`Husk parallel benchmark`);
  console.log(`  Mode:              ${MODE}`);
  console.log(`  Lightpanda binary: ${binary}`);
  console.log(`  URLs to visit:     ${urls.length}`);
  console.log(`  Pool min-warm:     ${POOL_MIN}`);
  console.log(`  Pool max-parallel: ${POOL_MAX}`);
  console.log("");

  const pool = new EnginePool({
    minWarm: POOL_MIN,
    maxParallel: POOL_MAX,
    spawnOptions: { binary, readinessTimeoutMs: 15_000 },
  });
  const tPoolReady0 = Date.now();
  await pool.ready();
  const tPoolReady = Date.now() - tPoolReady0;
  console.log(`Pool warmed: ${tPoolReady}ms (${POOL_MIN} processes)`);
  console.log("");

  // For batch modes we need a SessionManager + MethodContext.
  const sessions = new SessionManager(async () => {
    const engine = await pool.acquire();
    return Session.create({ engine });
  });
  const ctx = {
    sessions,
    version: "0.0.0",
    vault: null as unknown,
    credentials: null as unknown,
  } as unknown as MethodContext;

  const start = Date.now();
  let results: Result[] = [];

  if (MODE === "pool") {
    results = await Promise.all(
      urls.map(async (url, idx): Promise<Result> => {
        const t0 = Date.now();
        try {
          const engine = await pool.acquire();
          const session = await Session.create({ engine });
          try {
            await session.goto(url);
            const snap = await session.snapshot();
            return {
              idx, url, ok: true, count: snap.count,
              payloadBytes: JSON.stringify(snap).length,
              ms: Date.now() - t0,
            };
          } finally {
            await session.close();
          }
        } catch (e) {
          return { idx, url, ok: false, ms: Date.now() - t0, error: (e as Error).message };
        }
      })
    );
  } else if (MODE === "batch") {
    const items = await batchVisit(ctx, { urls });
    results = items.map((it, idx) => ({
      idx,
      url: it.url,
      ok: it.ok,
      count: it.snapshot?.count,
      payloadBytes: it.snapshot ? JSON.stringify(it.snapshot).length : undefined,
      error: it.error,
    }));
  } else if (MODE === "batch-extract") {
    // GitHub repo pages: description sits inside the about section.
    // ".f4.my-3" is the modern desktop description selector.
    // Non-GitHub pages (example.com, HN) won't match — that's intentional;
    // they return null text but still count as ok (no error).
    const extract = { css: ".f4.my-3" };
    const items = await batchVisit(ctx, { urls, extract });
    results = items.map((it, idx) => ({
      idx,
      url: it.url,
      ok: it.ok,
      payloadBytes: it.text != null ? it.text.length : 0,
      error: it.error,
    }));
  } else {
    throw new Error(`Unknown BENCH_MODE: ${MODE}`);
  }

  const elapsed = Date.now() - start;

  await sessions.closeAll().catch(() => {});
  await pool.close();

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const payloads = ok.map((r) => r.payloadBytes ?? 0).filter((b) => b > 0);
  const avgPayload = payloads.length
    ? Math.round(payloads.reduce((a, b) => a + b, 0) / payloads.length)
    : 0;

  console.log("Results:");
  console.log(`  Total wall clock:    ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`  URLs succeeded:      ${ok.length}/${urls.length}`);
  console.log(`  URLs failed:         ${failed.length}`);
  if (MODE === "pool" && ok.length > 0) {
    const sortedMs = ok.map((r) => r.ms ?? 0).sort((a, b) => a - b);
    const avgMs = Math.round(ok.reduce((a, r) => a + (r.ms ?? 0), 0) / ok.length);
    const p50 = sortedMs[Math.floor(sortedMs.length * 0.5)] ?? 0;
    const p95 = sortedMs[Math.floor(sortedMs.length * 0.95)] ?? 0;
    const p99 = sortedMs[Math.floor(sortedMs.length * 0.99)] ?? 0;
    console.log(`  Per-URL avg:         ${avgMs}ms`);
    console.log(`  Per-URL p50/p95/p99: ${p50}ms / ${p95}ms / ${p99}ms`);
  }
  console.log(`  Avg payload bytes:   ${avgPayload}`);
  console.log(`  Throughput:          ${(urls.length / (elapsed / 1000)).toFixed(2)} URLs/sec`);
  if (failed.length > 0) {
    console.log("");
    console.log("First 5 failures:");
    for (const f of failed.slice(0, 5)) {
      console.log(`  [${f.idx}] ${f.url}: ${f.error}`);
    }
  }
}

main().catch((e) => { console.error("Bench failed:", e); process.exit(1); });
