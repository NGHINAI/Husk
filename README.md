# Husk

**The only OSS browser engine where your agent cannot click a button that doesn't exist.**

Browser engine for AI agents, wrapped in a TypeScript orchestrator and Python SDK,
with a deterministic watchdog that physically blocks hallucinated actions.

License: AGPL v3 (core) · MIT (examples + protocol)
Status: v0.0.13-m14 — Snapshot Maximalism shipped

---

## Why Husk

Every "AI browser" today is a Playwright wrapper around full Chromium —
~500 MB RAM, ~800 ms cold-start, full paint pipeline running for nobody.
And no safety floor: when your LLM hallucinates a selector, the browser
cheerfully clicks nothing and your downstream logic confuses itself.

Husk is the opposite stack:

- **Real browser engine, not a wrapper.** Zig. No paint,
  no GPU, ~50 MB binary, ~10 ms cold-start. JavaScript still executes;
  pixels never render.
- **Watchdog as a feature.** Every action passes through a deterministic
  rule engine. Element not found → rejection with concrete alternatives.
  Policy rule says "never click delete in this flow" → blocked. No LLM
  guarding LLM. No latency tax. No fuzzy semantics.
- **Semantic stable IDs.** Identify elements by role + accessible name +
  landmark — invariant across CSS rebuilds. Per-site graph cached in SQLite.
- **LLM-neutral.** Husk doesn't bundle an LLM client. The SDK is browser
  primitives only. Bring your own model.

## What It Can Do

A single MCP / SDK / HTTP surface gives an agent everything it needs to drive any website:

**Read the page**
- `husk_snapshot` returns a one-shot **universal context dump**: accessibility tree, page meta (title / canonical / OpenGraph / JSON-LD), `<form>` schemas with field types and labels, recent network requests + likely JSON API endpoints, console messages, a rule-based page summary ("Login page — fields: email, password"), session history of the last 10 actions, a state signature, and (optionally) a base64 screenshot.
- Three snapshot modes: `full`, `terse` (drops nav/banner/footer subtrees), `visible` (only nodes whose bbox intersects the viewport — smallest payload).
- Targeted extraction: `husk_extract({css})` for one selector, or `husk_extract({selectors: {price: ".price", title: "h1"}})` for many in one round-trip. Add `paginate: {next, max_pages}` to extract across N pages in a single call.

**Drive the page**
- `husk_click` / `husk_type` / `husk_scroll` / `husk_upload` all accept `{intent: "sign in button"}` instead of a stable id — resolved via deterministic accessibility-tree scoring in ~1 ms. Ambiguous intent returns the top candidates with viewport position so the agent disambiguates.
- Every action returns the **post-action snapshot inline** — agents stop calling `husk_snapshot` after every click.
- `husk_wait_for` blocks until text appears, a role+name matches, a URL regex matches, the network goes idle, or a CSS selector becomes visible.
- `husk_scroll({until: <predicate>})` collapses infinite-scroll polling into one tool call.
- `husk_press_key`, `husk_login` (with TOTP / stored credentials), `husk_upload` (file path or base64).

**Run safely**
- Layer 1 watchdog (sanity): existence, visibility, enabled state, role-vs-verb compatibility. Always on.
- Layer 2 watchdog (policy): YAML rules — `forbidden`, `required_before`, `allow_domains`, `deny_domains`. Opt-in per session.
- Per-node reliability scoring — selectors that historically worked rank higher; flaky ones decay.

**Run fast at scale**
- Engine pool pre-warms processes and scales to the system's free-memory limit.
- `husk_batch_visit({urls, extract?})` fans out across many URLs in one tool call — terse snapshot or targeted extract per URL.
- 50 URLs measured at 2.50–4.00 s wall clock end-to-end.

**Watch what the agent sees**
- When the orchestrator binds to `127.0.0.1`, it serves a live viewer at `http://127.0.0.1:PORT/watch`. `husk_create_session` returns a `watch_url` so the agent can offer "Want to watch what I'm seeing?" — opens a dark-themed tab with the live accessibility tree on the left and a color-coded event log on the right.

## How to Use It

Husk speaks four interfaces — pick whichever fits your stack. All four call the same orchestrator.

### 1. MCP (Claude Desktop, Cursor, Continue, Windsurf)

Add this to your MCP config:

```json
{
  "mcpServers": {
    "husk": {
      "command": "node",
      "args": ["/path/to/husk/mcp/dist/index.js"]
    }
  }
}
```

Restart your AI client. Then in chat:

> Use husk to open hacker news, get the title and score for every story across pages 1–3.

Claude calls `husk_create_session` → `husk_goto` → `husk_extract({selectors, paginate: {next, max_pages: 3}})`. Three tool calls. Done.

### 2. TypeScript SDK

```ts
import { Husk } from "@husk/sdk";

const husk = new Husk({ baseUrl: "http://127.0.0.1:7777" });
const session = await husk.createSession();
await session.goto("https://news.ycombinator.com");
const result = await session.extract({
  selectors: { title: ".titleline a", score: ".score" },
  paginate: { next: { intent: "More" }, max_pages: 3 },
});
console.log(result.total_pages, result.pages);
```

### 3. Python SDK

```python
from husk import Husk

async with Husk(base_url="http://127.0.0.1:7777") as h:
    s = await h.create_session()
    await s.goto("https://news.ycombinator.com")
    r = await s.extract(
        selectors={"title": ".titleline a", "score": ".score"},
        paginate={"next": {"intent": "More"}, "max_pages": 3},
    )
    print(r["total_pages"], r["pages"])
```

### 4. CLI / HTTP JSON-RPC

```sh
husk start --port 7777
```

Then drive it directly:

```sh
curl -s -X POST http://127.0.0.1:7777/v1/jsonrpc \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"create_session"}'
```

The CLI also has `husk vault list` / `husk login --profile <p> --key <k>` for credential management.

## What's Shipping in v0

| Capability | Status |
|---|---|
| Browser runtime + engine pool (warm-K, elastic up to free-memory limit) | ✅ |
| Snapshot maximalism (meta / forms / network / console / summary / history / signature / image) | ✅ |
| Post-action snapshot inline on every action | ✅ |
| Intent-routed click / type / scroll / upload | ✅ |
| `husk_wait_for`, scroll-until, extract paginate | ✅ |
| Multi-selector extract + `husk_batch_visit` | ✅ |
| Watchdog (sanity + policy, deterministic, no LLM) | ✅ |
| Cookie vault + TOTP login + credential store (AES-GCM) | ✅ |
| TypeScript SDK + Python SDK | ✅ |
| MCP server (Claude Desktop / Cursor / Continue / Windsurf) | ✅ |
| CLI + HTTP JSON-RPC | ✅ |
| Live `/watch` viewer (127.0.0.1, SSE) | ✅ |
| SSO / SAML / OIDC | v0.2 |
| Chrome adapter (hydration-heavy sites: Gmail, Salesforce, GitHub repo headers, etc.) | v0.3 |
| Cloud-hosted Husk | v0.3 |
| IndexedDB (affects Firebase Auth, Auth0 SPA, AWS Amplify) | inherited engine limitation; flagged in v0.2 |

## Quickstart

```sh
# Prerequisites: Node 20, pnpm 9, Python 3.11+
git clone https://github.com/NGHINAI/Husk
cd Husk

# Install the engine binary
mkdir -p ~/.husk/bin
curl -fsSL -o ~/.husk/bin/lightpanda \
  https://github.com/lightpanda-io/browser/releases/download/0.3.0/lightpanda-$(uname -m | sed 's/x86_64/x86_64/;s/arm64/aarch64/')-$(uname -s | tr A-Z a-z)
chmod +x ~/.husk/bin/lightpanda
export LIGHTPANDA_BIN=~/.husk/bin/lightpanda

# Build husk
pnpm install
make all

# Smoke test
make test

# One-shot demo
node ./orchestrator/dist/index.js demo https://example.com | head -50

# Or run the full HTTP/JSON-RPC server (runs until you Ctrl-C)
node ./orchestrator/dist/index.js start --port 7777

# In another terminal — drive Husk over HTTP
curl -s -X POST http://127.0.0.1:7777/v1/jsonrpc \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"create_session"}'
```

Full quickstart: [`docs/quickstart.md`](./docs/quickstart.md)
Architecture: [`docs/architecture.md`](./docs/architecture.md)
Full design: [`docs/superpowers/specs/2026-05-13-husk-design.md`](./docs/superpowers/specs/2026-05-13-husk-design.md)

## Repository Layout

```
husk/
├── engine/         # browser engine + patches
├── orchestrator/   # TypeScript — Node binary, HTTP API, watchdog, action planner
├── sdk-ts/         # @husk/sdk — canonical TS client
├── sdk-py/         # husk-sdk — Python client
├── mcp/            # @husk/mcp — Model Context Protocol bridge
├── protocol/       # JSON-RPC + schemas (single source of truth)
├── examples/       # Demo agents
└── docs/           # Quickstart, architecture, policy rules, specs
```

## Performance

Husk pre-warms a pool of engine processes and elastically scales up to
the system's free-memory limit when concurrent sessions are requested.
Action results carry a `diff` field (and the post-action snapshot) so
agents avoid full re-snapshot round-trips. `husk_batch_visit` lets agents
fan out across many URLs in a single tool call.

### 50-URL benchmark (measured 2026-05-15)

| Mode | Wall clock | Throughput | Avg payload | Notes |
|---|---|---|---|---|
| `pool` (N parallel sessions, full snapshot per URL) | **2.72s** | 18.36 URLs/sec | 43 KB | Baseline; BENCH_POOL_MAX=10 |
| `batch_visit` (terse snapshot per URL) | **4.00s** | 12.50 URLs/sec | 172 KB | Single tool call from the agent |
| `batch_visit` + extract (`.f4.my-3`) | **2.50s** | 19.97 URLs/sec | ~0 bytes | Targeted text only; null for non-matching pages |

Engine pool warmup (K=4 warm processes): ~125 ms. All three runs: 50/50 URLs succeeded.

Reproduce:
```sh
LIGHTPANDA_BIN=<path> BENCH_POOL_MAX=10 pnpm --filter husk-orchestrator run bench
BENCH_MODE=batch         LIGHTPANDA_BIN=<path> pnpm --filter husk-orchestrator run bench
BENCH_MODE=batch-extract LIGHTPANDA_BIN=<path> pnpm --filter husk-orchestrator run bench
```

Knobs: `BENCH_N` (URL count, default 50), `BENCH_POOL_MIN` (warm processes, default 4), `BENCH_POOL_MAX` (max parallel, default min(50, N)).

Architecture notes — `docs/superpowers/specs/2026-05-13-husk-design.md` §5.6.

## Batch operations

When an agent needs to process many URLs, the most efficient pattern is a
single `husk_batch_visit` call rather than 50 `husk_goto`+`husk_snapshot` pairs:

```json
{
  "tool": "husk_batch_visit",
  "arguments": {
    "urls": [
      "https://example.com/",
      "https://news.ycombinator.com/",
      "https://en.wikipedia.org/wiki/Kubernetes"
    ],
    "extract": { "css": "meta[name='description']" }
  }
}
```

Returns:

```json
{
  "results": [
    { "url": "https://example.com/",                          "ok": true, "text": "..." },
    { "url": "https://news.ycombinator.com/",                 "ok": true, "text": "..." },
    { "url": "https://en.wikipedia.org/wiki/Kubernetes",      "ok": true, "text": "..." }
  ]
}
```

All URLs are fetched in parallel through the engine pool. Per-URL errors
are isolated (one bad URL doesn't break the rest). With `extract`, each
result is ~200 bytes; without it, each is a terse snapshot.

**Note:** `extract` uses `Runtime.evaluate` on the current DOM. Husk renders
static HTML but does not execute client-side JS hydration that some modern apps
rely on (e.g. GitHub's repo description div is React-rendered and won't be visible
via `extract`). For those targets, use server-rendered selectors like
`meta[name='description']` or wait for the Chrome adapter (v0.3).

## Dynamic workflows (M13)

- **`husk_wait_for`** — wait for text, role+name, URL regex, network-idle, or CSS visibility (10s default timeout)
- **Intent-routed actions** — `husk_click`/`husk_type`/`husk_scroll`/`husk_upload` accept `{intent: "sign in button"}` instead of `{stable_id}`; deterministic AX resolution, ambiguity returns candidates
- **`husk_upload`** — `file_path` or `content_base64+filename` → file input set (path-traversal sanitized)
- **Multi-selector `husk_extract`** — `{selectors: {price: ".price", title: "h1"}}` → one round-trip, returns `{key: text|null}` map
- **Page-readiness** — `goto` resolves on real `loadEventFired` + network-idle, not a fixed delay

### Watch UI

When `husk start` binds to 127.0.0.1, the orchestrator serves a live viewer at `http://127.0.0.1:PORT/watch`. `create_session` returns `{session_id, watch_url}` so agents can proactively offer the URL: "want to watch what I'm seeing?". Live AX tree on the left, color-coded event log on the right. No external assets, no framework.

## Snapshot Maximalism (M14)

`husk_snapshot` is your one-stop context dump:

```
{
  root, url, mode,
  signature: { dom_hash, network_fingerprint },
  meta:    { title, canonical, og, jsonld },
  forms:   [{ fields, submit_text }],
  network: { recent[], likely_api_endpoints[] },
  console: [],
  summary: "Login page — fields: email, password",
  session_history: [last 10 actions],
  image_b64?  // when include_image:true
}
```

And every action returns the post-state inline — `husk_click`/`type`/`scroll`/`upload`/`goto`/`login` now include `snapshot` in their result. Stop calling `husk_snapshot` after every action.

### New modes & options

- `husk_snapshot({mode: "visible"})` — only nodes whose bbox intersects the viewport (smallest payload)
- `husk_snapshot({include_image: true})` — base64 PNG attached to the result
- `husk_scroll({until: { text|role+name|url_matches|network_idle|selector_visible }})` — scroll-until, replaces polling loops
- `husk_extract({selectors, paginate: { next: { intent }, max_pages: 10 }})` — extract across N pages in one call

### Turn-count math

Pre-M14: `goto → snapshot → click → snapshot → extract` (5 turns).
M14: `goto → click → extract` (3 turns). Each click/goto carries its post-snapshot.

MCP surface unchanged: 18 tools.

## Multi-Context + Human-in-the-Loop (M15)

Three new primitives unlock the workflows agents couldn't do alone:

### Multi-tab (folds into create_session)

```ts
const tabA = await husk.createSession({});                              // root tab
const tabB = await husk.createSession({ parent_session_id: tabA.id });  // sibling tab
const tabC = await husk.createSession({ parent_session_id: tabA.id });  // another sibling

await tabA.goto("https://amazon.com/widget");
await tabB.goto("https://walmart.com/widget");
await tabC.goto("https://target.com/widget");

const snapA = await tabA.snapshot();
// snapA.sibling_sessions === [tabB.id, tabC.id]

await tabA.close();  // cascade-closes tabB and tabC too
```

### Ask the human a question

```ts
const r = await session.askHuman({
  question: "Two products match. Pick one:",
  options: ["Acme Widget $19.99", "Beta Widget $22.49"],
});
// r === { pending: true, token: "...", watch_url: "...", surface: {...} }
// Agent relays surface.question + options to chat. User answers in chat OR in Watch UI.
// Whichever fires first wins.
```

### Handoff (for ANY case where a human is needed)

```ts
const r = await session.handoff({
  reason: "captcha",
  suggested_action: "Solve the hCaptcha then come back to resume",
  need_cookies_back: true,
});
// Session is paused server-side. Subsequent click/type/etc. return session_paused.
// User opens r.handoff_url, solves the captcha, captures cookies via bookmarklet.
// Husk imports cookies, unpauses the session. Next agent action succeeds.
```

Use cases: captcha, 2FA, OAuth consent, account verification, KYC, connecting external accounts, payment confirmation, destructive-action approval, unrecoverable engine errors.

### Watch UI v2

Live `/watch` viewer now shows:
- **Sibling tab chips** — click to switch viewer between tabs in a group
- **Inline question banner** — answer the agent's question without leaving the viewer
- **Inline handoff banner** — link to the handoff page for cookie capture + resume

### MCP surface

**21 tools total**, +3 from M14: `husk_ask_human`, `husk_handoff`, `husk_resume`. Everything else folds into existing verbs.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). All contributions require signing
the [CLA](./CLA.md).

## License

Core: AGPL v3 ([LICENSE](./LICENSE))
Examples and protocol schemas: MIT ([LICENSE-EXAMPLES](./LICENSE-EXAMPLES))
Upstream engine attribution: see [engine/UPSTREAM_LICENSE](./engine/UPSTREAM_LICENSE)
