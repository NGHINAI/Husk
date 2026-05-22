# Husk M16 — Seamless Session Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** When the agent hits a wall that needs the user's real browser session (login with HttpOnly cookies, captcha, OAuth consent, 2FA), `husk_handoff` launches the user's actual Chrome at the target URL, watches it via CDP, and when login completes pulls cookies back into the lightpanda session — **automatically, no bookmarklet, no devtools paste, no buttons to click**. From the agent's side it's a single blocking tool call. From the user's side: open Chrome, log in normally, done.

**Architecture:** New `husk_handoff({mode: "seamless"})` variant. Husk spawns `google-chrome --remote-debugging-port=<free> --user-data-dir=~/.husk/handoff-profiles/<token> <target_url>`. Connects to that Chrome's CDP. Subscribes to `Page.frameNavigated`. On URL-change-away-from-login (heuristic + fallback "I'm done" overlay button), reads `Network.getAllCookies` for the relevant domain, imports into lightpanda via `Network.setCookies`, closes Chrome, resolves the blocking tool call. **MCP surface unchanged** — `mode` is a new param on existing `husk_handoff`.

**Tech stack:** TypeScript orchestrator. Cross-platform Chrome detection (macOS / Linux / Windows / Brave / Edge / Chromium). Re-uses M5's CDP plumbing (the same client that drives lightpanda) but pointed at a different process. Re-uses M15's `Session.importCookies()`. AGPL.

**Spec references:** §5.11 (NEW — Seamless Session Transfer). Lands in T9.

**Design locks:**
- `mode: "seamless"` is the new default for `husk_handoff` when `need_cookies_back: true`. Old paste-mode stays as a fallback for headless environments or when Chrome detection fails.
- **Blocking** by design (unlike M15's non-blocking handoff). The agent's tool call doesn't return until completion or timeout. MCP supports long-running calls — Claude/Cursor are tolerant of multi-minute responses.
- **Per-handoff Chrome profile** (`~/.husk/handoff-profiles/<token>`) — never reuses the user's default Chrome profile. Clean slate per handoff. Auto-deleted on completion.
- **No persistent Chrome** — closed immediately after cookie sync OR on timeout.
- **Completion detection** — primary signal is URL pattern change (away from `/login`, `/auth`, `/sign-in` to anything else on the same domain). Fallback: tiny overlay injected via `Page.addScriptToEvaluateOnNewDocument` with an "I'm done" button that POSTs to Husk.
- **Cookies are scoped** — only cookies for the target domain (and its subdomains) flow back. No cross-site cookie leakage.
- **Local-only** — like Watch UI, the seamless mode only works when orchestrator is bound to 127.0.0.1. Remote binds fall back to paste mode.

---

## Walkthrough: full seamless flow

```
┌──────────┐                ┌────────────┐                ┌──────────────┐
│  Agent   │                │ Husk       │                │  User Chrome │
│ (Claude) │                │ orchestr.  │                │  (real)      │
└────┬─────┘                └─────┬──────┘                └────┬─────────┘
     │ husk_click(submit) on    │                                  │
     │ linkedin.com/login        │                                  │
     │ ──────────────────────────►                                  │
     │                            │ form submits → 404 / captcha    │
     │ rejection / watchdog block │                                  │
     │ ◄──────────────────────────                                  │
     │                            │                                  │
     │ husk_handoff({             │                                  │
     │   reason: "LinkedIn login",│                                  │
     │   mode: "seamless",        │                                  │
     │   need_cookies_back: true, │                                  │
     │   target_url:              │                                  │
     │     "https://linkedin.com/ │                                  │
     │      login"                │                                  │
     │ })                         │                                  │
     │ ──────────────────────────►                                  │
     │                            │ 1. session.pause()              │
     │                            │ 2. mint token                   │
     │                            │ 3. find free port (9223)        │
     │                            │ 4. mkdir profile dir            │
     │                            │ 5. spawn:                       │
     │                            │      google-chrome \            │
     │                            │        --remote-debugging-      │
     │                            │           port=9223 \           │
     │                            │        --user-data-dir=<dir> \  │
     │                            │        https://linkedin.com/    │
     │                            │           login                 │
     │                            │                                  │
     │                            │              ────────────────► (opens Chrome)
     │                            │              ◄──── CDP connect (ws://localhost:9223)
     │                            │              ◄──── Page.frameNavigated
     │                            │                     (currently on /login)
     │                            │                                  │
     │                            │ Watch UI emits:                 │
     │                            │ 'seamless_chrome_opened'        │
     │                            │ "waiting on your Chrome…"        │
     │                            │                                  │
     │ [agent BLOCKS on the       │                                  │
     │  husk_handoff call —       │                                  │
     │  no other tool work        │                                  │
     │  happens until it returns] │                                  │
     │                            │                                  │
     │                            │              [User types email + │
     │                            │               password, solves   │
     │                            │               captcha, enters    │
     │                            │               2FA — all natively │
     │                            │               in their real      │
     │                            │               Chrome. No tools,  │
     │                            │               no paste.]         │
     │                            │                                  │
     │                            │              ◄── Page.frameNavigated
     │                            │                     (now on /feed)
     │                            │ 6. detect "not on login anymore"│
     │                            │ 7. Network.getAllCookies        │
     │                            │ 8. filter for linkedin.com +    │
     │                            │      subdomains                 │
     │                            │ 9. lightpanda.send(             │
     │                            │      "Network.setCookies",      │
     │                            │      {cookies: [...]}           │
     │                            │    )                            │
     │                            │ 10. close Chrome (gracefully)   │
     │                            │ 11. rm -rf profile dir          │
     │                            │ 12. session.resume()            │
     │                            │ 13. Watch UI emits 'resumed'    │
     │                            │                                  │
     │ husk_handoff RESOLVES:     │                                  │
     │   { resumed: true,         │                                  │
     │     cookies_imported: 12,  │                                  │
     │     ms_paused: 47210,      │                                  │
     │     final_url:             │                                  │
     │       "linkedin.com/feed"} │                                  │
     │ ◄──────────────────────────                                  │
     │                            │                                  │
     │ husk_snapshot              │                                  │
     │ ──────────────────────────► (logged-in LinkedIn feed visible) │
```

---

## Completion detection

**Primary signal — URL pattern change.** Most login flows redirect away from the login URL on success:
- `linkedin.com/login` → `linkedin.com/feed/` ✓
- `github.com/login` → `github.com/` ✓
- `accounts.google.com/signin` → `accounts.google.com/MyAccount` or the original target ✓

Detector:
1. Record `initial_url` when Chrome opens (e.g., `linkedin.com/login`)
2. On each `Page.frameNavigated` event for the main frame, check if URL is still in a "login-y" pattern (`/login`, `/signin`, `/sign-in`, `/auth/`, `/oauth/`, `/2fa`, `/challenge`, etc.) on the same domain
3. When URL is on the same domain (or its subdomains) but NOT in any login-y path → **trigger completion**
4. Add a small debounce (1s) — some flows briefly land on `/login?success=true` before bouncing

**Fallback — "I'm done" overlay button.** Some flows complete without leaving the login URL (e.g., SPA-style logins). Inject a fixed-position overlay via `Page.addScriptToEvaluateOnNewDocument`:

```javascript
(() => {
  const btn = document.createElement("button");
  btn.id = "__husk_done";
  btn.textContent = "✓ I'm done — return to agent";
  btn.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:2147483647;padding:12px 20px;background:#3fb950;color:#0d1117;border:none;border-radius:6px;font-family:ui-monospace,monospace;font-weight:600;font-size:14px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.3)`;
  btn.addEventListener("click", () => {
    fetch("http://127.0.0.1:__HUSK_PORT__/handoff/__TOKEN__/seamless-done", { method: "POST" });
    btn.textContent = "✓ Returning to agent…";
    btn.disabled = true;
  });
  document.documentElement.appendChild(btn);
})();
```

Either signal (URL change OR button click) resolves the handoff.

---

## Cookie scoping

After completion, before importing, filter cookies to only those for the target domain + its subdomains. For `linkedin.com`:
- Keep: `linkedin.com`, `.linkedin.com`, `www.linkedin.com`, `static.linkedin.com`
- Drop: `google.com`, `doubleclick.net`, etc. (third-party trackers Chrome accumulated)

Use the `domain` field on each CDP cookie. Match against target domain's "registrable domain" (eTLD+1). Don't reinvent — use a small `parseDomain` helper or `node:url` URL parsing.

---

## Chrome detection (cross-platform)

```typescript
// orchestrator/src/handoff/chrome-launcher.ts
const CANDIDATES = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/brave-browser",
    "/usr/bin/microsoft-edge",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
};

export function findChrome(): string | null {
  const paths = CANDIDATES[process.platform as keyof typeof CANDIDATES] ?? [];
  for (const p of paths) if (existsSync(p)) return p;
  return null;
}
```

If no Chrome is found, `husk_handoff({mode: "seamless"})` falls back to paste mode with a clear error indicator in the returned surface.

---

## File structure

**New files:**
- `orchestrator/src/handoff/chrome-launcher.ts` — find Chrome binary, spawn with CDP port + profile dir
- `orchestrator/src/handoff/chrome-watcher.ts` — connect to spawned Chrome's CDP, subscribe to Page.frameNavigated, detect completion
- `orchestrator/src/handoff/completion-detector.ts` — URL-pattern heuristic + overlay button script
- `orchestrator/src/handoff/cookie-sync.ts` — scope cookies to target domain, transform CDP-shape between two engines
- `orchestrator/src/handoff/seamless-orchestrator.ts` — top-level: spawn → watch → import → cleanup
- 6 test files

**Modified files:**
- `orchestrator/src/http/methods.ts` — `handoff` method accepts `mode: "seamless" | "paste"`, dispatches accordingly
- `orchestrator/src/hitl/bus.ts` — extend `startHandoff` to accept an optional completion-signal that's NOT user-driven (Chrome event triggers resolve)
- `orchestrator/src/http/hitl-routes.ts` — new `POST /handoff/:token/seamless-done` for the overlay button fallback
- `orchestrator/src/watch/events.ts` — add `seamless_chrome_opened` event
- `orchestrator/src/watch/index.html.ts` — banner mentions "waiting on your Chrome…" when seamless mode active
- `mcp/src/tool-surface.ts` — `husk_handoff` description updated to default to seamless when `need_cookies_back: true`, document the blocking semantic
- SDKs (TS + Py) — `mode` param added
- Spec §5.11 + README + memory

---

## Task map

| # | Task | Model | Est |
|---|---|---|---|
| T1 | Chrome launcher: cross-platform detection, free-port allocation, spawn with profile dir + remote-debugging | Sonnet | 2h |
| T2 | Chrome CDP watcher: connect to spawned Chrome, subscribe to Page.frameNavigated, expose async iterable of nav events | Sonnet | 2.5h |
| T3 | Completion detector: URL-pattern heuristic + overlay button injection (Page.addScriptToEvaluateOnNewDocument) + POST endpoint | Sonnet | 2.5h |
| T4 | Cookie scoping + sync: filter by target domain, transform shapes, import via lightpanda's Network.setCookies | Sonnet | 2h |
| T5 | Seamless orchestrator: ties T1+T2+T3+T4 together; spawn → watch → import → cleanup. Blocking. Timeout-aware. | Sonnet | 2.5h |
| T6 | `husk_handoff({mode: "seamless"})` wiring + paste-mode fallback when Chrome not detected + bus extension | Sonnet | 2h |
| T7 | Watch UI v3: "waiting on your Chrome" banner state; cleanup on resolved | Sonnet | 1.5h |
| T8 | MCP description update (seamless-by-default for need_cookies_back) + SDKs (`mode` param) + integration test | Sonnet | 2h |
| T9 | Spec §5.11 + README + memory + tag v0.0.15-m16 + merge --no-ff + push | Haiku | 1h |

**Total:** 9 tasks, ~18h (~2 days). **MCP surface unchanged** — `mode` is a new param on `husk_handoff`.

---

## Task 1 — Chrome launcher

**Files:**
- Create: `orchestrator/src/handoff/chrome-launcher.ts`
- Test: `orchestrator/tests/handoff/chrome-launcher.test.ts`

### Steps

- [ ] **Step 1: Failing test** — `findChrome()` returns first existing path; spawn flags include `--remote-debugging-port` and `--user-data-dir`; rejects when no Chrome found.

- [ ] **Step 2: Implement** — see Chrome detection block above. `spawnChrome(targetUrl, profileDir, port)` uses `child_process.spawn` with the appropriate path + flags + `detached: false` so it dies with the orchestrator.

- [ ] **Step 3: Wait-for-CDP-ready helper** — Chrome takes ~500ms to bind the debugging port. After spawn, poll `http://localhost:<port>/json/version` until 200 (max 10s).

- [ ] **Step 4: Commit** — `feat(handoff): cross-platform Chrome launcher with CDP port + isolated profile`

---

## Task 2 — Chrome CDP watcher

**Files:**
- Create: `orchestrator/src/handoff/chrome-watcher.ts`
- Test: `orchestrator/tests/handoff/chrome-watcher.test.ts`

### Design

Reuses the existing CDP client (the same one driving lightpanda) but pointed at the spawned Chrome's port. Subscribes to `Page.frameNavigated` for the main frame only (ignore subframe navs). Emits a stream of `{url, ts}` events.

### Steps

- [ ] **Step 1: Test** — mocked Chrome with WS-stub; ChromeWatcher subscribes, emits events, cleanly disconnects.

- [ ] **Step 2: Implement** — `connectToChrome(port: number)` returns a `ChromeWatcher` with `onNavigation(cb)` + `close()`.

- [ ] **Step 3: Commit** — `feat(handoff): CDP watcher for spawned Chrome (navigation events)`

---

## Task 3 — Completion detector

**Files:**
- Create: `orchestrator/src/handoff/completion-detector.ts`
- Test: `orchestrator/tests/handoff/completion-detector.test.ts`

### Detector logic

```typescript
const LOGIN_PATTERNS = [/\/login/i, /\/signin/i, /\/sign-in/i, /\/auth\b/i, /\/oauth/i, /\/2fa/i, /\/challenge/i, /\/verify/i];

function isOnLoginPage(url: string): boolean {
  return LOGIN_PATTERNS.some((re) => re.test(new URL(url).pathname));
}

function sameDomain(target: string, observed: string): boolean {
  const t = new URL(target).hostname;
  const o = new URL(observed).hostname;
  // strip leading "www." for both, compare eTLD+1
  return stripWww(o).endsWith(stripWww(t)) || stripWww(t).endsWith(stripWww(o));
}

export function detectCompletion(initialUrl: string, observedUrl: string): boolean {
  return sameDomain(initialUrl, observedUrl) && !isOnLoginPage(observedUrl);
}
```

Plus overlay injection helper:

```typescript
export function buildOverlayScript(token: string, huskPort: number): string {
  return `... (script content from earlier in plan) ...`;
}
```

### Steps

- [ ] **Step 1: Tests** — detectCompletion returns true for `/login` → `/feed` on same domain; false when still on `/login`; false when domain changes (OAuth redirect to provider).

- [ ] **Step 2: Implement** + integration with overlay script

- [ ] **Step 3: Commit** — `feat(handoff): completion detector (URL pattern + overlay button fallback)`

---

## Task 4 — Cookie scoping + sync

**Files:**
- Create: `orchestrator/src/handoff/cookie-sync.ts`
- Test: `orchestrator/tests/handoff/cookie-sync.test.ts`

### Logic

```typescript
function eTldPlusOne(hostname: string): string {
  // Simple version: take last 2 dotted parts. For .co.uk etc, would need PSL — defer.
  const parts = hostname.replace(/^\./, "").split(".");
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}

export function scopeCookies(cookies: CdpCookie[], targetUrl: string): CdpCookie[] {
  const targetETld = eTldPlusOne(new URL(targetUrl).hostname);
  return cookies.filter((c) => eTldPlusOne(c.domain.replace(/^\./, "")) === targetETld);
}

export async function syncCookiesFromChrome(chromePort: number, lightpandaSession: SessionLike, targetUrl: string): Promise<number> {
  const chromeClient = await connectToChromeCdp(chromePort);
  const { cookies } = await chromeClient.send("Network.getAllCookies");
  const scoped = scopeCookies(cookies, targetUrl);
  await lightpandaSession.importCookies(scoped);
  await chromeClient.close();
  return scoped.length;
}
```

### Steps

- [ ] Tests, implement, commit `feat(handoff): cookie scoping + sync from Chrome to lightpanda`

---

## Task 5 — Seamless orchestrator (ties T1-T4)

**Files:**
- Create: `orchestrator/src/handoff/seamless-orchestrator.ts`
- Test: integration-style test in `orchestrator/tests/handoff/seamless-flow.test.ts`

### Top-level

```typescript
export interface SeamlessHandoffOpts {
  session: Session;
  target_url: string;
  timeout_ms: number;
  token: string;
  huskPort: number;
}

export async function runSeamlessHandoff(opts: SeamlessHandoffOpts): Promise<ResolvedHandoff> {
  const chromePath = findChrome();
  if (!chromePath) {
    return { resumed: false, reason: "chrome_not_found", ms_paused: 0, cookies_imported: 0 };
  }
  const profileDir = await mkdtemp(`/tmp/husk-handoff-${opts.token}-`);
  const port = await findFreePort();
  const child = spawnChrome(chromePath, opts.target_url, profileDir, port);
  await waitForCdpReady(port, 10_000);

  // Inject the overlay button on every page navigation
  const watcher = await connectToChrome(port);
  await watcher.injectScript(buildOverlayScript(opts.token, opts.huskPort));

  const startedAt = Date.now();
  return new Promise<ResolvedHandoff>((resolve) => {
    let resolved = false;
    const finish = async (reason: "url_change" | "button" | "timeout") => {
      if (resolved) return;
      resolved = true;
      try {
        if (reason === "timeout") {
          resolve({ resumed: false, reason: "timeout", ms_paused: Date.now() - startedAt, cookies_imported: 0 });
        } else {
          const count = await syncCookiesFromChrome(port, opts.session, opts.target_url);
          resolve({ resumed: true, cookies_imported: count, ms_paused: Date.now() - startedAt });
        }
      } finally {
        watcher.close();
        child.kill();
        await rm(profileDir, { recursive: true, force: true });
      }
    };

    watcher.onNavigation((url) => {
      if (detectCompletion(opts.target_url, url)) finish("url_change");
    });

    // The /handoff/:token/seamless-done endpoint resolves via this signal:
    opts.session.onSeamlessDone = () => finish("button");

    setTimeout(() => finish("timeout"), opts.timeout_ms);
  });
}
```

### Steps

- [ ] Integration test (skipped if no Chrome on test machine), implement, commit `feat(handoff): seamless orchestrator — spawn Chrome, watch, sync, cleanup`

---

## Task 6 — Wire into husk_handoff

**Files:**
- Modify: `orchestrator/src/http/methods.ts` — handoff method dispatches on `mode`
- Modify: `orchestrator/src/http/hitl-routes.ts` — add `POST /handoff/:token/seamless-done`
- Modify: `orchestrator/src/hitl/bus.ts` — extend bus contract minimally

### Routing

```typescript
handoff: async (ctx, params) => {
  if (!params.reason?.trim()) throw new Error("handoff requires a reason");

  const session = ctx.sessions.get(params.session_id);
  session.pause({ token: "...", handoff_url: null });

  const mode = params.mode ?? (params.need_cookies_back ? "seamless" : "paste");

  if (mode === "seamless") {
    const target_url = params.target_url ?? session.getCurrentUrl();
    if (!target_url) throw new Error("seamless handoff requires target_url or current session URL");

    // Blocking — return only when Chrome flow resolves
    const result = await runSeamlessHandoff({
      session, target_url, timeout_ms: params.timeout_ms ?? 600_000,
      token: ..., huskPort: ctx.portRef!.value,
    });
    session.resume();
    return result;
  } else {
    // Existing paste-mode behavior (M15 T6) — unchanged
    return /* existing paste flow */;
  }
},
```

### Commit

`feat(handoff): husk_handoff mode:"seamless" — blocking flow with Chrome spawn + cookie sync`

---

## Task 7 — Watch UI v3

Banner state: when seamless mode is active, the watch UI shows a different banner ("Waiting in your Chrome — log in there and Husk will resume automatically"). On resolved, banner clears.

Tiny diff to `index.html.ts`. Single commit.

`feat(watch): UI v3 — seamless-mode banner`

---

## Task 8 — MCP description + SDKs

### MCP description update

For `husk_handoff`, add to existing description:

```
SEAMLESS MODE (recommended for sites with login walls): pass mode:"seamless" and need_cookies_back:true and target_url:"https://...". Husk launches the user's real Chrome at that URL, the user logs in normally (captcha, 2FA, OAuth all just work natively), and Husk pulls the session cookies back automatically when the user navigates past the login page. The tool call BLOCKS until completion or timeout (default 10min). When this returns ok:true, your session is already authenticated — just retry the action you wanted to do.

PASTE MODE (fallback when Chrome isn't installed or user prefers manual): mode:"paste" or omit need_cookies_back. Returns immediately; user opens the handoff URL and pastes cookies or clicks Resume. Slower UX, but works in any environment.

If you pass mode:"seamless" and Chrome isn't detected on the user's machine, the tool returns {resumed:false, reason:"chrome_not_found"} — re-call with mode:"paste" as the fallback.
```

### SDKs

TS/Py — add `mode?` and `target_url?` to handoff input.

### Commit

`feat(mcp): husk_handoff seamless mode in description + SDKs`

---

## Task 9 — Docs + tag + merge + push

- Spec §5.11 covering: motivation (HttpOnly cookie problem), seamless flow walkthrough, completion detection, cookie scoping, Chrome detection + fallback, blocking semantics, security (per-handoff profile, scoped cookies)
- Decision U: Seamless transfer is the default for `need_cookies_back: true` when Chrome is detected
- Decision V: Per-handoff Chrome profile (never reuse user's default profile) — clean slate, no contamination
- README: "Seamless Session Transfer (M16)" section
- Memory: roadmap (`v0.0.15-m16`), architecture (Decisions U + V), overview (capability list)
- Tag `v0.0.15-m16`, --no-ff merge to main, push

---

## Self-review

**Spec coverage:** All 9 tasks map to one capability. T1-T5 build the core machinery, T6 wires it in, T7-T8 surface it, T9 ships. ✓

**Type consistency:** Reuses `ResolvedHandoff` from M15 (extended with `chrome_not_found` reason). Reuses `Session.importCookies` from M15. Reuses CDP client. ✓

**Tool bloat check:** **+0 new MCP tools.** `husk_handoff` gains a `mode` param. Per Decision N this is a fold-in. ✓

**Engine limitations:** Chrome must be installed. If not, paste-mode fallback. Documented in description and in spec §5.11. ✓

**Blocking semantics:** MCP supports long-running tool calls. Claude / Cursor / Continue all tested with multi-minute calls. The `timeout_ms` cap prevents stuck-forever. ✓

**Security:** Per-handoff Chrome profile means no cross-contamination with user's normal browser state. Cookies scoped to target eTLD+1 — no cross-site leakage. Local-only — orchestrator must be on 127.0.0.1. ✓

---

## Execution handoff

Plan saved. Branch will be `m16-seamless-session-transfer` (to cut from main after plan commit).

Two execution options:
1. **Subagent-Driven** (recommended) — same flow that shipped M14 + M15
2. **Inline**
