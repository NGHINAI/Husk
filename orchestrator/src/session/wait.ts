export interface WaitForCondition {
  text?: string;
  role?: string;
  name?: string;
  url_matches?: string;
  network_idle?: number;
  selector_visible?: string;
  timeout_ms?: number;
}

export interface WaitForResult {
  ok: boolean;
  condition_met?: "text" | "role_name" | "url_matches" | "network_idle" | "selector_visible";
  reason?: "timeout";
  waited_ms: number;
  stable_id?: string;
}

interface SessionLike {
  snapshot(opts?: { force?: boolean }): Promise<{ url: string; nodes: Array<{ i: string; r: string; n: string }> }>;
  runtimeEval(expr: string): Promise<unknown>;
}

const POLL_MS = 100;

export async function runWaitFor(session: SessionLike, c: WaitForCondition): Promise<WaitForResult> {
  if (!c.text && !(c.role && c.name) && !c.url_matches && c.network_idle === undefined && !c.selector_visible) {
    throw new Error("husk_wait_for: at least one condition required (text, role+name both required, url_matches, network_idle, selector_visible)");
  }
  const timeout = c.timeout_ms ?? 10_000;
  const start = Date.now();
  const urlRe = c.url_matches ? new RegExp(c.url_matches) : null;

  while (Date.now() - start < timeout) {
    const snap = await session.snapshot({ force: false });
    if (c.text) {
      const hit = snap.nodes.find((n) => n.n?.includes(c.text!));
      if (hit) return { ok: true, condition_met: "text", waited_ms: Date.now() - start, stable_id: hit.i };
    }
    if (c.role && c.name) {
      const hit = snap.nodes.find((n) => n.r === c.role && n.n === c.name);
      if (hit) return { ok: true, condition_met: "role_name", waited_ms: Date.now() - start, stable_id: hit.i };
    }
    if (urlRe && urlRe.test(snap.url)) {
      return { ok: true, condition_met: "url_matches", waited_ms: Date.now() - start };
    }
    if (c.selector_visible) {
      const expr = `(() => {
        const el = document.querySelector(${JSON.stringify(c.selector_visible)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return (r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none') ? 'visible' : null;
      })()`;
      const result = await session.runtimeEval(expr);
      if (result === "visible") {
        return { ok: true, condition_met: "selector_visible", waited_ms: Date.now() - start };
      }
    }
    if (c.network_idle !== undefined) {
      const expr = `(() => {
        if (!('performance' in window) || typeof performance.getEntriesByType !== 'function') return null;
        const entries = performance.getEntriesByType('resource');
        if (entries.length === 0) return 'idle';
        const last = entries[entries.length - 1];
        const since = performance.now() - (last.responseEnd || last.startTime);
        return since >= ${c.network_idle} ? 'idle' : null;
      })()`;
      const r = await session.runtimeEval(expr);
      if (r === "idle") return { ok: true, condition_met: "network_idle", waited_ms: Date.now() - start };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { ok: false, reason: "timeout", waited_ms: Date.now() - start };
}
