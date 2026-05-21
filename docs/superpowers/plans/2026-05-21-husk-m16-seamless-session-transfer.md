# Husk M16 — Seamless Session Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace M15's cookie-paste / bookmarklet roundtrip with a **Husk-managed Chrome window** that:
1. Pre-loads lightpanda's session cookies
2. Opens at the same URL the agent was stuck on
3. Lets the user complete the human-only step (sign-in, 2FA, captcha, OAuth, payment confirm, KYC) in a real browser
4. Re-syncs cookies (including HttpOnly) back into lightpanda via CDP
5. Agent picks up exactly where it left off — same session, same URL, fresh auth state

**MCP surface change:** **+0 new tools.** `husk_handoff` gains a `mode: "transfer" | "manual"` parameter. `"transfer"` is the new default; `"manual"` falls back to the M15 paste-back UX for systems without Chrome. Surface stays at 21.

**Tech stack:** TypeScript orchestrator. CDP against a spawned Chrome process (separate from lightpanda's CDP). Chrome locator + launcher + lifecycle. JS overlay injection via `Runtime.evaluate`. Per-handoff `--user-data-dir` for clean isolation. No browser extension required.

**Spec references:** §5.11 (NEW — Seamless Session Transfer). Lands in T11.

---

## Walkthrough — what M16 delivers (the canonical flow)

```
┌──────────┐                ┌────────────┐                ┌──────────┐
│  Agent   │                │ Husk       │                │  Human   │
│ (Claude) │                │ orchestr.  │                │          │
└────┬─────┘                └─────┬──────┘                └────┬─────┘
     │  husk_click(submit)         │                                 │
     │ ───────────────────────────►│                                 │
     │                              │ Amazon 2FA wall                 │
     │                              │ husk_type fails (tel-input)     │
     │  watchdog rejects            │                                 │
     │ ◄────────────────────────────│                                 │
     │                              │                                 │
     │  husk_handoff({              │                                 │
     │    reason: "2FA code",       │                                 │
     │    mode: "transfer"  ◄────── NEW M16 mode (default)            │
     │  })                          │                                 │
     │ ───────────────────────────►│                                 │
     │                              │ session.pause()                 │
     │                              │ token = mint()                  │
     │                              │ 1. Locate Chrome binary         │
     │                              │ 2. Spawn Chrome with:           │
     │                              │    --user-data-dir=~/.husk/     │
     │                              │      handoff-chrome/<token>     │
     │                              │    --remote-debugging-port=PORT │
     │                              │ 3. Connect CDP to Chrome:PORT   │
     │                              │ 4. Install lightpanda cookies   │
     │                              │    via Network.setCookies       │
     │                              │ 5. Navigate Chrome to           │
     │                              │    current_url                  │
     │                              │ 6. Inject overlay JS via        │
     │                              │    Page.addScriptToEvaluate     │
     │                              │    OnNewDocument                │
     │  RETURNS IMMEDIATELY:        │                                 │
     │  { pending: true,            │                                 │
     │    token,                    │                                 │
     │    mode: "transfer",         │                                 │
     │    chrome_opened: true,      │                                 │
     │    handoff_url: ...   ────── │ ── fallback link if Chrome      │
     │  }                            │      didn't open                │
     │ ◄────────────────────────────│                                 │
     │                              │                                 │
     │  Agent's chat reply:         │                                 │
     │  "I opened a browser window  │                                 │
     │   on the 2FA page. Solve it  │                                 │
     │   and click 'Resume agent'   │                                 │
     │   in the floating button."   │                                 │
     │                              │                                 │
     │                              │       [CHROME WINDOW OPEN]      │
     │                              │       URL: amazon.com/.../verify│
     │                              │       Cookies: from lightpanda  │
     │                              │       Overlay: bottom-right     │
     │                              │       button "Resume agent"     │
     │                              │              ↓                  │
     │                              │       Human types OTP from phone│
     │                              │       Page progresses to        │
     │                              │       amazon.com/checkout/...   │
     │                              │       Human clicks overlay      │
     │                              │              ↓                  │
     │                              │ Overlay POSTs                   │
     │                              │ /handoff/:token/resume          │
     │                              │ ◄───────────────────────────────│
     │                              │                                 │
     │                              │ 7. CDP to Chrome:               │
     │                              │    Network.getAllCookies        │
     │                              │ 8. Filter cookies to            │
     │                              │    current_url's domain         │
     │                              │ 9. CDP to lightpanda:           │
     │                              │    Network.setCookies(filtered) │
     │                              │ 10. Tear down Chrome process    │
     │                              │ 11. Delete per-token profile    │
     │                              │ 12. session.resume()            │
     │                              │ 13. Emit 'resumed' WatchEvent   │
     │                              │                                 │
     │  Agent's next husk_* call    │                                 │
     │  succeeds. Snapshot shows    │                                 │
     │  the logged-in state. ───────┼─►                               │
```

## Why this works for ANY case the human needs to handle

The handoff Chrome window is a **real Chrome** with **lightpanda's session cookies**. Whatever the human needs to do — captcha, OTP, OAuth consent, magic-link click (because their email is in another tab in the SAME Chrome instance), KYC photo upload, payment confirmation — they do it in a fully-functional browser. The agent sees the result via cookie sync.

Critically: **HttpOnly cookies cross over.** `Network.getAllCookies` returns them; `document.cookie` (M15's bookmarklet) can't. This is the whole reason M15's bookmarklet didn't work for real auth.

---

## Design decisions

**D1 — Per-handoff isolated Chrome profile.** Each handoff spawns Chrome with a unique `--user-data-dir=~/.husk/handoff-chrome/<token>`. Cleaned up on resume. No interference with the user's normal Chrome. No accidental sharing of state across handoffs.

**Tradeoff:** the user doesn't have their normal Chrome extensions / saved passwords / bookmarks in this window. Acceptable for v1 — the window is for the specific handoff task, not general browsing.

**D2 — Inject overlay via `Runtime.evaluate`, not extension.** No extension to install. CSP rarely blocks injected scripts run via CDP (devtools-level injection). Falls back gracefully — if injection fails on a strict CSP, the user opens `http://127.0.0.1:7777/handoff/<token>` directly to find the Resume button.

**D3 — Cookie scope filtering.** When syncing cookies back, only sync cookies for the domain of `current_url` (and subdomains). Don't pull in the user's logged-in Google session if they happened to visit gmail.com in the handoff Chrome.

**D4 — Mode parameter on existing tool.** `husk_handoff({mode: "transfer"})` (default) launches Chrome. `mode: "manual"` falls back to the M15 paste UX (for systems without Chrome, or for CI/headless contexts).

**D5 — Chrome auto-detect with graceful fallback.** Try standard Chrome paths per OS. If none found, return `{chrome_opened: false}` and automatically degrade to `mode: "manual"` — the agent can still proceed, just without the Chrome convenience.

**D6 — Security: Chrome's debug port bound to 127.0.0.1, random port.** No remote attack surface. Per-handoff random port (not a fixed one) so even malicious local processes can't easily race.

**D7 — Single-tab Chrome.** Launch Chrome with the current_url as the ONLY tab. Disable other features (no first-run wizard, no signed-in browsing prompt) via Chrome flags. Window says "Husk handoff — close when done" in the title.

---

## File structure

**New files:**
- `orchestrator/src/handoff/chrome-locator.ts` — find Chrome binary per OS
- `orchestrator/src/handoff/chrome-launcher.ts` — spawn Chrome with right flags; lifecycle
- `orchestrator/src/handoff/chrome-cdp.ts` — connect to Chrome's debug port; cookie ops
- `orchestrator/src/handoff/overlay-script.ts` — exports `OVERLAY_SCRIPT` (JS string injected into Chrome pages)
- `orchestrator/src/handoff/transfer-orchestrator.ts` — wires locator + launcher + cdp + overlay
- `orchestrator/src/handoff/cookie-filter.ts` — scope cookies to current_url's domain
- Tests (7 files)

**Modified files:**
- `orchestrator/src/http/methods.ts` — `handoff` accepts `mode` param
- `orchestrator/src/http/hitl-routes.ts` — `/handoff/:token` page shows Chrome-launch status; `/handoff/:token/resume` differentiates source (chrome / paste / overlay)
- `orchestrator/src/http/handoff-page.html.ts` — show "Chrome opened" status if `mode:"transfer"` succeeded
- `orchestrator/src/hitl/bus.ts` — extend `PendingHandoff` with `mode` and `chrome_pid?`
- `orchestrator/src/session/session.ts` — `Session.importCookiesScoped(domain, cookies)`
- `mcp/src/tool-surface.ts` — `husk_handoff` description update (mode param)
- SDKs (TS + Py)
- Spec §5.11 + README + memory

---

## Task map

| # | Task | Surface change | Model | Est |
|---|---|---|---|---|
| T1 | Chrome locator — find binary per OS (mac/linux/windows); graceful "not found" return | infra | Haiku | 1h |
| T2 | Chrome launcher — spawn with flags, attach debug port, lifecycle (close on signal) | infra | Sonnet | 2.5h |
| T3 | Chrome CDP client — connect to debug port, send `Network.setCookies` + `Network.getAllCookies` + `Page.navigate` | infra | Sonnet | 2h |
| T4 | Overlay script — floating "Resume agent" button injected via `Page.addScriptToEvaluateOnNewDocument` + `Runtime.evaluate` for already-loaded pages; styled to be obviously Husk | UI script | Sonnet | 2h |
| T5 | Cookie filter — only sync cookies matching current_url's domain (+ subdomains) | logic | Haiku | 1h |
| T6 | Transfer orchestrator — wire locator + launcher + cdp + overlay into one async function `startTransferHandoff(token, current_url, cookies)`; lifecycle | infra | Sonnet | 2.5h |
| T7 | `husk_handoff({mode: "transfer"\|"manual"})` — mode param flows through; "transfer" attempts Chrome launch, gracefully degrades to "manual" if Chrome not found | RPC + MCP description | Sonnet | 2h |
| T8 | Handoff page HTML v2 — shows chrome-opened status + the existing paste fallback below; updates dynamically when overlay button is clicked | embedded HTML | Sonnet | 1.5h |
| T9 | Lifecycle + cleanup — Chrome process killed on resume/timeout; per-token profile dir removed; CDP client closed | infra | Sonnet | 1.5h |
| T10 | Real Chrome integration test — spawn Chrome, set cookie, get cookie back, verify scoped filter; full handoff round-trip if Chrome installed in CI | integration | Sonnet | 2.5h |
| T11 | Spec §5.11 + README + memory + tag v0.0.15-m16 + merge --no-ff + push | docs | Haiku | 1h |

**Total:** 11 tasks, ~21.5h (~2-2.5 working days). **MCP surface unchanged at 21.**

---

## Task 1 — Chrome locator

**Files:**
- Create: `orchestrator/src/handoff/chrome-locator.ts`
- Test: `orchestrator/tests/handoff/chrome-locator.test.ts`

### Failing test

```typescript
import { describe, it, expect, vi } from "vitest";
import { locateChrome } from "../../src/handoff/chrome-locator.js";
import * as fs from "node:fs";

describe("locateChrome", () => {
  it("returns the path on macOS when default Chrome is installed", () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p) =>
      String(p) === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    const r = locateChrome({ platform: "darwin" });
    expect(r.path).toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(r.found).toBe(true);
  });

  it("returns found:false on macOS when no Chrome", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const r = locateChrome({ platform: "darwin" });
    expect(r.found).toBe(false);
    expect(r.tried).toContain("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  });

  it("falls back to Chromium when Chrome not installed (linux)", () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p) =>
      String(p) === "/usr/bin/chromium" || String(p) === "/usr/bin/chromium-browser");
    const r = locateChrome({ platform: "linux" });
    expect(r.found).toBe(true);
    expect(r.path).toMatch(/chromium/);
  });

  it("honors HUSK_CHROME_BINARY env override", () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p) => String(p) === "/custom/chrome");
    const r = locateChrome({ platform: "darwin", env: { HUSK_CHROME_BINARY: "/custom/chrome" } });
    expect(r.path).toBe("/custom/chrome");
  });
});
```

### Implementation

```typescript
// orchestrator/src/handoff/chrome-locator.ts
import { existsSync } from "node:fs";

export interface LocateOpts {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
}

export interface LocateResult {
  found: boolean;
  path?: string;
  tried: string[];
}

const CANDIDATES: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

export function locateChrome(opts: LocateOpts = {}): LocateResult {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const override = env.HUSK_CHROME_BINARY;
  const tried: string[] = [];

  if (override) {
    tried.push(override);
    if (existsSync(override)) return { found: true, path: override, tried };
  }
  for (const candidate of CANDIDATES[platform] ?? []) {
    tried.push(candidate);
    if (existsSync(candidate)) return { found: true, path: candidate, tried };
  }
  return { found: false, tried };
}
```

### Commit

```
feat(handoff): chrome binary locator (per-OS paths + HUSK_CHROME_BINARY override)
```

---

## Task 2 — Chrome launcher

**Files:**
- Create: `orchestrator/src/handoff/chrome-launcher.ts`
- Test: `orchestrator/tests/handoff/chrome-launcher.test.ts`

### Design

Spawn Chrome with these flags:
- `--user-data-dir=<unique-per-token>` — isolated profile
- `--remote-debugging-port=0` — random port (Chrome writes to DevToolsActivePort file)
- `--no-first-run --no-default-browser-check --disable-features=...` — kill the new-user wizard
- `--disable-translate --disable-extensions` — keep the window clean
- Target URL as the last positional argument

After spawn, **read the DevToolsActivePort file** (Chrome writes the actual port number to `<user-data-dir>/DevToolsActivePort` after startup) to learn the debug port.

### Test

```typescript
import { describe, it, expect, vi } from "vitest";
import { ChromeLauncher } from "../../src/handoff/chrome-launcher.js";

describe("ChromeLauncher", () => {
  it("spawns Chrome with the right flags", async () => {
    const spawnedArgs: string[] = [];
    const launcher = new ChromeLauncher({
      binary: "/fake/chrome",
      spawn: (cmd, args) => { spawnedArgs.push(...args); return { pid: 12345, kill: vi.fn() } as any; },
      readActivePort: async () => 9876,
    });
    const r = await launcher.launch({ url: "https://example.com", profileDir: "/tmp/p1" });
    expect(spawnedArgs).toContain("--user-data-dir=/tmp/p1");
    expect(spawnedArgs).toContain("--remote-debugging-port=0");
    expect(spawnedArgs).toContain("--no-first-run");
    expect(spawnedArgs[spawnedArgs.length - 1]).toBe("https://example.com");
    expect(r.pid).toBe(12345);
    expect(r.port).toBe(9876);
  });

  it("close() kills the process and cleans the profile dir", async () => {
    const kill = vi.fn();
    const rm = vi.fn();
    const launcher = new ChromeLauncher({
      binary: "/fake/chrome",
      spawn: () => ({ pid: 12345, kill } as any),
      readActivePort: async () => 9876,
      rmSync: rm,
    });
    const r = await launcher.launch({ url: "/", profileDir: "/tmp/p1" });
    await launcher.close(r);
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(rm).toHaveBeenCalledWith("/tmp/p1", expect.objectContaining({ recursive: true, force: true }));
  });

  it("readActivePort throws if file never appears within timeout", async () => {
    const launcher = new ChromeLauncher({
      binary: "/fake/chrome",
      spawn: () => ({ pid: 1, kill: vi.fn() } as any),
      readActivePort: async () => { throw new Error("timeout"); },
    });
    await expect(launcher.launch({ url: "/", profileDir: "/tmp/p" })).rejects.toThrow(/timeout/);
  });
});
```

### Implementation sketch

```typescript
// orchestrator/src/handoff/chrome-launcher.ts
import { spawn as childSpawn, ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface LaunchOpts {
  url: string;
  profileDir?: string;  // optional; auto-created if omitted
}

export interface LaunchResult {
  pid: number;
  port: number;
  profileDir: string;
  process: ChildProcess;
}

export interface LauncherOpts {
  binary: string;
  spawn?: typeof childSpawn;
  readActivePort?: (profileDir: string, timeoutMs?: number) => Promise<number>;
  rmSync?: typeof rmSync;
}

const FLAGS = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-features=TranslateUI,PrivacySandboxSettings4",
  "--disable-translate",
  "--disable-extensions",
  "--disable-component-update",
  "--remote-debugging-port=0",
  "--remote-debugging-address=127.0.0.1",
];

export class ChromeLauncher {
  constructor(private opts: LauncherOpts) {}

  async launch(args: LaunchOpts): Promise<LaunchResult> {
    const profileDir = args.profileDir ?? mkdtempSync(join(tmpdir(), "husk-handoff-chrome-"));
    const flags = [...FLAGS, `--user-data-dir=${profileDir}`, args.url];
    const spawnFn = this.opts.spawn ?? childSpawn;
    const proc = spawnFn(this.opts.binary, flags, { detached: false, stdio: "ignore" }) as ChildProcess;
    const readPort = this.opts.readActivePort ?? defaultReadActivePort;
    const port = await readPort(profileDir, 10_000);
    return { pid: proc.pid!, port, profileDir, process: proc };
  }

  async close(launch: LaunchResult): Promise<void> {
    try { launch.process.kill("SIGTERM"); } catch { /* ignore */ }
    // Give Chrome 1s to clean up, then force
    await new Promise((r) => setTimeout(r, 500));
    try { launch.process.kill("SIGKILL"); } catch { /* ignore */ }
    const rm = this.opts.rmSync ?? rmSync;
    try { rm(launch.profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function defaultReadActivePort(profileDir: string, timeoutMs: number): Promise<number> {
  const path = join(profileDir, "DevToolsActivePort");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) {
      const contents = readFileSync(path, "utf8").trim().split("\n");
      const port = parseInt(contents[0] ?? "", 10);
      if (Number.isFinite(port) && port > 0) return port;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Chrome DevToolsActivePort timeout (${timeoutMs}ms): ${path}`);
}
```

### Commit

```
feat(handoff): Chrome launcher with per-handoff profile + auto-discovered debug port
```

---

## Task 3 — Chrome CDP client (cookie ops)

**Files:**
- Create: `orchestrator/src/handoff/chrome-cdp.ts`
- Test: `orchestrator/tests/handoff/chrome-cdp.test.ts`

### What it does

Connects to `ws://127.0.0.1:<port>/devtools/browser/...` (Chrome's CDP endpoint). Exposes:
- `setCookies(cookies)` — install pre-handoff cookies before user starts
- `getAllCookies()` — pull cookies after user finishes
- `close()` — disconnect

Reuse the existing lightpanda CDP client architecture if reusable. Most likely the WebSocket plumbing in `orchestrator/src/engine/cdp-client.ts` can be lifted into a shared base class — but for v1, a separate minimal client is fine. Don't over-DRY.

### Test

```typescript
import { describe, it, expect, vi } from "vitest";
import { ChromeCdp } from "../../src/handoff/chrome-cdp.js";

describe("ChromeCdp", () => {
  it("setCookies sends Network.setCookies with the right shape", async () => {
    const sent: any[] = [];
    const cdp = new ChromeCdp({
      send: vi.fn().mockImplementation(async (method, params) => {
        sent.push({ method, params });
        return {};
      }),
    });
    await cdp.setCookies([
      { name: "session", value: "abc", domain: ".amazon.com", path: "/", secure: true },
    ]);
    expect(sent[0].method).toBe("Network.setCookies");
    expect(sent[0].params.cookies).toHaveLength(1);
  });

  it("getAllCookies returns the array from Network.getAllCookies", async () => {
    const cdp = new ChromeCdp({
      send: vi.fn().mockResolvedValue({
        cookies: [{ name: "s", value: "v", domain: ".x.com" }],
      }),
    });
    const r = await cdp.getAllCookies();
    expect(r).toEqual([{ name: "s", value: "v", domain: ".x.com" }]);
  });

  it("addInitScript calls Page.addScriptToEvaluateOnNewDocument", async () => {
    const sent: any[] = [];
    const cdp = new ChromeCdp({
      send: vi.fn().mockImplementation(async (method, params) => { sent.push({ method, params }); return {}; }),
    });
    await cdp.addInitScript("console.log('hi')");
    expect(sent[0].method).toBe("Page.addScriptToEvaluateOnNewDocument");
    expect(sent[0].params.source).toContain("console.log");
  });
});
```

### Implementation

Minimal wrapper around an injected send function for testability; production uses a real WebSocket.

### Commit

```
feat(handoff): Chrome CDP client (cookie set/get + init script injection)
```

---

## Task 4 — Overlay script

**File:** `orchestrator/src/handoff/overlay-script.ts`

### Behavior

A small floating button injected into every page in the handoff Chrome. Bottom-right, always visible, says "✓ Resume agent". On click → POSTs to `http://127.0.0.1:<orchestrator_port>/handoff/<token>/resume`.

Token is baked into the script at injection time. Orchestrator port is baked in at injection time.

```typescript
// orchestrator/src/handoff/overlay-script.ts
export interface OverlayParams {
  token: string;
  orchestrator_origin: string;  // e.g., "http://127.0.0.1:7777"
}

export function buildOverlayScript(p: OverlayParams): string {
  // The script must work even on pages with strict CSP — that's why we use
  // CDP-level injection (Runtime.evaluate or Page.addScriptToEvaluateOnNewDocument);
  // CSP applies to <script> tags in HTML but not to scripts injected via CDP.
  return `
(function() {
  if (window.__huskOverlay) return;
  window.__huskOverlay = true;

  const btn = document.createElement("button");
  btn.id = "husk-resume-overlay";
  btn.textContent = "✓ Resume agent";
  Object.assign(btn.style, {
    position: "fixed", bottom: "16px", right: "16px",
    zIndex: "2147483647",
    padding: "12px 20px",
    background: "#3fb950", color: "#0d1117",
    border: "none", borderRadius: "6px",
    fontFamily: "ui-monospace, monospace", fontSize: "14px", fontWeight: "600",
    cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
  });

  let busy = false;
  btn.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    btn.textContent = "Resuming...";
    btn.style.background = "#8b949e";
    try {
      await fetch(${JSON.stringify(p.orchestrator_origin + "/handoff/" + p.token + "/resume")}, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "overlay", note: "resumed from chrome overlay" }),
      });
      btn.textContent = "✓ Done — you can close this window";
      btn.style.background = "#3fb950";
    } catch (e) {
      btn.textContent = "Error: " + e.message;
      btn.style.background = "#f85149";
      busy = false;
    }
  });

  if (document.body) document.body.appendChild(btn);
  else document.addEventListener("DOMContentLoaded", () => document.body.appendChild(btn));
})();
`;
}
```

### Test

```typescript
import { describe, it, expect } from "vitest";
import { buildOverlayScript } from "../../src/handoff/overlay-script.js";

describe("buildOverlayScript", () => {
  it("bakes in the token and orchestrator origin", () => {
    const s = buildOverlayScript({ token: "tok-abc", orchestrator_origin: "http://127.0.0.1:7777" });
    expect(s).toContain("http://127.0.0.1:7777/handoff/tok-abc/resume");
  });

  it("produces a parseable JS expression (no syntax errors)", () => {
    const s = buildOverlayScript({ token: "x", orchestrator_origin: "http://x" });
    expect(() => new Function(s)).not.toThrow();
  });

  it("is idempotent (window.__huskOverlay guard)", () => {
    const s = buildOverlayScript({ token: "x", orchestrator_origin: "http://x" });
    expect(s).toContain("__huskOverlay");
  });

  it("uses max z-index (2147483647) to stay on top", () => {
    const s = buildOverlayScript({ token: "x", orchestrator_origin: "http://x" });
    expect(s).toContain("2147483647");
  });
});
```

### Commit

```
feat(handoff): overlay script for floating "Resume agent" button
```

---

## Task 5 — Cookie scope filter

**Files:**
- Create: `orchestrator/src/handoff/cookie-filter.ts`
- Test: `orchestrator/tests/handoff/cookie-filter.test.ts`

### Why

When user opens email.com in the handoff Chrome to fetch their OTP, their email cookies are now in that profile. We MUST NOT install those email cookies into lightpanda's session. Only sync cookies for the domain of `current_url` and its subdomains.

### Test

```typescript
import { describe, it, expect } from "vitest";
import { filterCookiesForDomain } from "../../src/handoff/cookie-filter.js";

const c = (name: string, domain: string) => ({ name, value: "v", domain, path: "/" });

describe("filterCookiesForDomain", () => {
  it("keeps cookies for the exact domain", () => {
    const r = filterCookiesForDomain([c("a", "amazon.com")], "https://amazon.com/foo");
    expect(r).toHaveLength(1);
  });

  it("keeps cookies for subdomains (.amazon.com matches www.amazon.com)", () => {
    const r = filterCookiesForDomain([c("a", ".amazon.com")], "https://www.amazon.com/");
    expect(r).toHaveLength(1);
  });

  it("keeps cookies for parent domain only when leading dot", () => {
    const r = filterCookiesForDomain(
      [c("a", ".amazon.com"), c("b", "subdomain.amazon.com")],
      "https://amazon.com/"
    );
    // .amazon.com matches (it's a parent-and-subdomain cookie); subdomain.amazon.com doesn't apply to bare amazon.com per RFC
    expect(r.map((c) => c.name)).toEqual(["a"]);
  });

  it("drops cookies for unrelated domains", () => {
    const r = filterCookiesForDomain(
      [c("a", "amazon.com"), c("g", "google.com"), c("ml", "gmail.com")],
      "https://amazon.com/"
    );
    expect(r.map((c) => c.name)).toEqual(["a"]);
  });

  it("handles URLs with port and path", () => {
    const r = filterCookiesForDomain([c("a", "localhost")], "http://localhost:7777/x");
    expect(r).toHaveLength(1);
  });

  it("returns empty array when URL is malformed", () => {
    expect(filterCookiesForDomain([c("a", "x.com")], "not-a-url")).toEqual([]);
  });
});
```

### Implementation

```typescript
// orchestrator/src/handoff/cookie-filter.ts
interface CookieLike { name: string; value: string; domain?: string; path?: string; [k: string]: unknown; }

export function filterCookiesForDomain(cookies: CookieLike[], url: string): CookieLike[] {
  let host: string;
  try { host = new URL(url).hostname; } catch { return []; }

  return cookies.filter((c) => {
    if (!c.domain) return false;
    const d = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
    if (host === d) return true;
    if (c.domain.startsWith(".") && host.endsWith("." + d)) return true;  // subdomain match for cookies with leading dot
    return false;
  });
}
```

### Commit

```
feat(handoff): cookie scope filter (only sync cookies for current_url's domain)
```

---

## Task 6 — Transfer orchestrator

**Files:**
- Create: `orchestrator/src/handoff/transfer-orchestrator.ts`
- Test: `orchestrator/tests/handoff/transfer-orchestrator.test.ts`

### What it does

The glue. Given a token + current_url + initial cookies (from lightpanda), it:
1. Locates Chrome (returns null if not found → orchestrator falls back to manual mode)
2. Launches Chrome with isolated profile
3. Connects CDP to Chrome
4. Injects the overlay script (via `Page.addScriptToEvaluateOnNewDocument`)
5. Sets initial cookies in Chrome
6. Navigates Chrome to current_url
7. Returns a handle with the launch result + CDP client

A separate method `completeTransfer(handle, current_url)` runs when the user clicks the overlay button (or the manual fallback fires):
1. CDP `Network.getAllCookies` from Chrome
2. Filter to `current_url`'s domain via T5
3. Returns the filtered cookies (orchestrator/methods.ts then imports them into lightpanda)
4. Close Chrome (CDP + launcher)

### Test (sketch — integration-style with mocked dependencies)

```typescript
import { describe, it, expect, vi } from "vitest";
import { TransferOrchestrator } from "../../src/handoff/transfer-orchestrator.js";

describe("TransferOrchestrator", () => {
  it("returns null when Chrome not found", async () => {
    const t = new TransferOrchestrator({
      locateChrome: () => ({ found: false, tried: [] }),
      launcher: undefined as any,
      makeCdp: undefined as any,
    });
    const handle = await t.start({ token: "x", current_url: "https://x", initial_cookies: [] });
    expect(handle).toBeNull();
  });

  it("launches Chrome, sets cookies, injects overlay, navigates, returns handle", async () => {
    const launched = { pid: 1, port: 9999, profileDir: "/tmp/p", process: { kill: vi.fn() } as any };
    const cdpSent: any[] = [];
    const t = new TransferOrchestrator({
      locateChrome: () => ({ found: true, path: "/fake/chrome", tried: [] }),
      launcher: { launch: async () => launched, close: async () => {} } as any,
      makeCdp: (port) => ({
        send: vi.fn().mockImplementation(async (method, params) => { cdpSent.push({ method, params }); return {}; }),
        close: async () => {},
      } as any),
      orchestrator_origin: "http://127.0.0.1:7777",
    });
    const handle = await t.start({
      token: "tok-1",
      current_url: "https://amazon.com/login",
      initial_cookies: [{ name: "s", value: "v", domain: ".amazon.com" }],
    });
    expect(handle).not.toBeNull();
    // Sent: addScriptToEvaluateOnNewDocument with overlay, setCookies, Page.navigate
    const methods = cdpSent.map((c) => c.method);
    expect(methods).toContain("Page.addScriptToEvaluateOnNewDocument");
    expect(methods).toContain("Network.setCookies");
    expect(methods).toContain("Page.navigate");
  });

  it("complete() returns filtered cookies and tears down Chrome", async () => {
    const cdp = {
      send: vi.fn().mockResolvedValue({ cookies: [
        { name: "ok", value: "v", domain: ".amazon.com" },
        { name: "out", value: "v", domain: ".google.com" },
      ]}),
      close: vi.fn(),
    };
    const closeLaunch = vi.fn();
    const t = new TransferOrchestrator({
      locateChrome: () => ({ found: true, path: "x", tried: [] }),
      launcher: { launch: async () => ({} as any), close: closeLaunch } as any,
      makeCdp: () => cdp as any,
      orchestrator_origin: "http://x",
    });
    // ... start, then complete ...
    // Assert: cookies returned contain only "ok", Chrome closed, CDP closed
  });
});
```

### Commit

```
feat(handoff): transfer orchestrator (locate + launch + inject overlay + cookie roundtrip)
```

---

## Task 7 — husk_handoff mode param + degrade

**Files:**
- Modify: `orchestrator/src/http/methods.ts` — handoff method accepts mode, calls TransferOrchestrator on transfer mode, falls back to manual
- Modify: `orchestrator/src/hitl/bus.ts` — extend PendingHandoff with mode + chrome state
- Modify: `mcp/src/tool-surface.ts` — description update
- Modify: SDKs

### handoff method changes

```typescript
handoff: async (ctx, params: {
  session_id: string;
  reason: string;
  suggested_action?: string;
  need_cookies_back?: boolean;
  mode?: "transfer" | "manual";
  timeout_ms?: number;
}) => {
  const mode = params.mode ?? "transfer";  // NEW default
  // ... existing setup ...

  let chrome_opened = false;
  let chrome_handle: TransferHandle | null = null;

  if (mode === "transfer" && ctx.transferOrch) {
    const lightpandaCookies = await session.getCurrentCookies();  // new Session method via CDP
    chrome_handle = await ctx.transferOrch.start({
      token,
      current_url: current_url ?? "about:blank",
      initial_cookies: lightpandaCookies,
    });
    chrome_opened = chrome_handle !== null;
  }

  // ... pause session, emit event, set up resume handler ...

  void promise.then(async (resolved) => {
    if (resolved.resumed) {
      if (chrome_handle) {
        // Transfer mode: pull cookies from Chrome, filter, import into lightpanda
        try {
          const chromeCookies = await ctx.transferOrch.complete(chrome_handle, current_url);
          await session.importCookies(chromeCookies);
        } catch { /* swallow — best-effort */ }
      } else if (resolved.cookies?.length) {
        // Manual mode (M15 path)
        await session.importCookies(resolved.cookies);
      }
    }
    if (chrome_handle) await ctx.transferOrch.teardown(chrome_handle);
    session.resume();
    ctx.watchBus?.emit(params.session_id, { kind: "resolved", ts: Date.now(), token, kind_resolved: "handoff" });
  });

  return {
    pending: true,
    token,
    mode: chrome_opened ? "transfer" : "manual",
    chrome_opened,
    handoff_url,
    surface: { reason: params.reason, suggested_action: params.suggested_action, current_url },
  };
},
```

### MCP description update

Prepend to existing husk_handoff description:

```
M16 NOTE: this tool now opens a real Chrome window for the user by default (mode: "transfer"). The user completes the task in that window — login, captcha, OTP, OAuth, payment confirmation, anything — and clicks a floating "Resume agent" button. Husk syncs cookies (including HttpOnly) back into your session via CDP. No cookie paste, no bookmarklet. If Chrome isn't installed, falls back automatically to the M15 manual paste UX (mode: "manual"). Pass mode: "manual" explicitly to force the paste UX (e.g., on a server without a GUI).
```

Add `mode` to inputSchema.

### Commit

```
feat(handoff): husk_handoff({mode: "transfer"}) launches Chrome with cookies preloaded
```

---

## Task 8 — Handoff page v2 (Chrome status)

When `mode: "transfer"` succeeded, the handoff page shows:
> "🟢 Chrome opened — complete your task there and click the floating Resume button. If Chrome didn't open or you want to use this page instead, the paste UX is below."

The existing paste UX stays as a fallback.

When `mode: "transfer"` failed (no Chrome found) or `mode: "manual"` was forced, only the paste UX shows.

### File

Modify `orchestrator/src/http/handoff-page.html.ts` — add a conditional section at the top:

```html
<div id="chromeStatus" style="display: __CHROME_DISPLAY__">
  <div class="status success">
    🟢 Chrome opened — complete your task there and click the floating "Resume agent" button.
    Cookies will sync back automatically.
  </div>
  <div class="meta">Don't see the Chrome window? Use the paste UX below.</div>
</div>
```

Substitution: `__CHROME_DISPLAY__` is "block" when transfer mode active, "none" otherwise.

### Commit

```
feat(handoff): handoff page v2 — Chrome-mode status + fallback paste UX below
```

---

## Task 9 — Lifecycle + cleanup

Edge cases to nail:
- Resume from Chrome overlay → Chrome closes, profile dir removed
- Resume from paste textarea (manual fallback) when Chrome is also open → Chrome closes, profile dir removed
- Timeout → Chrome closes, profile dir removed, session.resume() with `{resumed: false, reason: "timeout"}`
- Orchestrator killed (SIGTERM) while Chrome is open → Chrome should also die (use `detached: false` + parent kill cascades)
- Multiple concurrent handoffs → each gets its own Chrome with its own port + profile

### File

Modify `orchestrator/src/handoff/transfer-orchestrator.ts` — add `teardown(handle)` that's called from the bus resolution handler regardless of resumed/timeout outcome.

### Tests

Extend `tests/handoff/transfer-orchestrator.test.ts`:

```typescript
it("teardown closes Chrome and cleans profile dir even on timeout", async () => { ... });
it("two concurrent handoffs use separate ports + profiles", async () => { ... });
```

### Commit

```
feat(handoff): lifecycle — Chrome teardown on resume/timeout/parent-death
```

---

## Task 10 — Real Chrome integration test

**File:** `orchestrator/test/integration/m16-transfer.test.ts`

Gated by Chrome being installed (skip if `locateChrome()` returns `found: false`).

Test cases:
1. Spawn Chrome with a fake fixture URL, verify `DevToolsActivePort` appears, verify CDP connection works
2. Set a cookie via CDP, navigate, verify cookie present via `Network.getAllCookies`
3. Inject overlay script, verify it's actually present in the page (via `Runtime.evaluate("!!document.getElementById('husk-resume-overlay')")`)
4. Full round-trip: agent calls handoff({mode:"transfer"}), test client GETs `/handoff/:token/resume` via the overlay URL, Chrome closes, session unpauses

Run:
```bash
HUSK_INT=1 LIGHTPANDA_BIN=/Users/nirmalghinaiya/Desktop/husk/engine/spike/.scratch/lightpanda \
  pnpm --filter husk-orchestrator test test/integration/m16-transfer.test.ts
```

If Chrome installed: tests pass. If not: tests skip cleanly.

### Commit

```
test(integration): M16 transfer end-to-end (Chrome spawn + cookie roundtrip)
```

---

## Task 11 — Spec §5.11 + README + memory + tag + merge

### §5.11 outline

1. Motivation — M15 paste UX doesn't work for HttpOnly auth cookies (most real auth)
2. Architecture — Husk-managed Chrome via per-handoff `--user-data-dir` + random debug port
3. Walkthrough — the canonical agent → handoff → Chrome → user → resume → agent flow
4. Mode parameter — `transfer` (default) vs `manual` (fallback)
5. Cookie scope filter — only sync `current_url`'s domain
6. Overlay script — CDP-injected floating Resume button (bypasses CSP)
7. Lifecycle — per-handoff profile, killed on resume/timeout
8. Decision U — Per-handoff Chrome profile (isolated, throwaway)
9. Decision V — CDP-injection over browser extension (no install required)
10. Decision W — Cookie scope: only `current_url`'s domain, not the whole profile
11. Limitations — needs Chrome installed; user's normal Chrome extensions/saved-passwords not in handoff window; some sites with strict CSP may block overlay (paste UX still works)
12. MCP surface unchanged — `husk_handoff` gains `mode` param, no new tools

### README

Add a section "Seamless Session Transfer (M16)" after the M15 section. Highlight: paste UX → real Chrome window. HttpOnly cookies work. No bookmarklet. The "captcha story" demo now works end-to-end.

### Memory

- `husk-roadmap.md` — v0.0.15-m16 row
- `husk-architecture.md` — Decisions U, V, W
- `husk-overview.md` — capability update

### Tag + merge

```bash
git tag -a v0.0.15-m16 -m "M16: Seamless Session Transfer

- husk_handoff({mode: 'transfer'}) — launches real Chrome with lightpanda's cookies preloaded
- Cookie roundtrip via CDP Network.getAllCookies (includes HttpOnly — works for real auth)
- Per-handoff isolated Chrome profile (--user-data-dir)
- Floating 'Resume agent' overlay injected via Page.addScriptToEvaluateOnNewDocument
- Cookie scope filter — only sync current_url's domain
- Graceful fallback to M15 manual paste UX when Chrome not installed

MCP surface unchanged: 21 tools. mode param added to husk_handoff."
git checkout main
git merge --no-ff m16-seamless-session-transfer -m "Merge Milestone 16 (seamless session transfer)"
git push origin main
git push origin v0.0.15-m16
```

### Commit

```
docs: spec §5.11 + README seamless transfer (M16)
```

---

## Self-review

**Spec coverage:** Each of the M16 capabilities (locator, launcher, CDP, overlay, filter, orchestrator, mode param, page v2, lifecycle, integration test) maps to T1-T10; T11 closes docs+tag. ✓

**Tool bloat check:** **+0 new MCP tools.** `husk_handoff` gains a `mode` parameter. Surface stays at 21. ✓

**Backward compat:** existing `husk_handoff` callers without `mode` get the new default (`transfer`), but if Chrome isn't installed, automatically degrade to `manual` — they see the same M15 paste UX they had before. No breaking changes. ✓

**Engine dependencies:**
- Chrome installed: required for transfer mode. Graceful fallback if not.
- Lightpanda's `Network.setCookies`: required for cookie import. M15 already documented this limitation.

**Security:**
- Chrome debug port bound to 127.0.0.1 only (random port per handoff)
- Per-handoff profile dir is isolated; cleaned up on resume/timeout
- Cookie scope filter prevents leaking unrelated cookies into the agent session
- Orchestrator spawns Chrome as a child process — dies if orchestrator dies (no zombie)

**Open risks:**
- Sites with strict CSP might block the overlay button injection. Mitigation: handoff page (with paste UX) is always accessible as a fallback. Document in spec.
- Chrome locator might miss installations in non-default paths. Mitigation: `HUSK_CHROME_BINARY` env override.
- macOS Gatekeeper may prompt when running Chrome from a non-standard location. Mitigation: prefer system-installed Chrome.

**Why this is the right next milestone after the patches:** the M15 + post-M15 patches (CDP error wrapping, JS type fallback, anti-refusal description) already handle the bulk of "agent stuck on form fields" cases. M16 closes the remaining gap — real auth flows that require HttpOnly cookies the bookmarklet can't see.

---

## Execution handoff

Plan saved. Branch to be cut: `m16-seamless-session-transfer`.

Two execution modes:
1. **Subagent-Driven** (recommended) — same flow that shipped M13/M14/M15
2. **Inline** with checkpoints

Choose 1 or 2 (or "tweak X" for scope changes).
