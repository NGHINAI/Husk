# Husk

**The only OSS browser engine where your agent cannot click a button that doesn't exist.**

Browser engine for AI agents, wrapped in a TypeScript orchestrator and Python SDK,
with a deterministic watchdog that physically blocks hallucinated actions.

License: AGPL v3 (core) · MIT (examples + protocol)

---

## Why Husk

Every "AI browser" today is a Playwright wrapper around full Chromium —
~500 MB RAM, ~800 ms cold-start, full paint pipeline running for nobody.
And no safety floor: when your LLM hallucinates a selector, the browser
cheerfully clicks nothing and your downstream logic confuses itself.

Husk is the opposite stack:

- **Real browser engine, not a wrapper.** Forked lightpanda. Zig. No paint,
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

## What's Shipping in v0

| Pillar | v0 status |
|---|---|
| Browser runtime (consumes prebuilt lightpanda binary) | ✅ |
| Snapshot compression (a11y-tree-based JSON-LD with full text preserved) | ✅ |
| Watchdog (sanity + policy, deterministic, no LLM) | ✅ |
| TypeScript SDK + Python SDK | ✅ |
| MCP server (Claude Desktop / Cursor / Continue / Windsurf) | ✅ |
| CLI | ✅ |
| Auth pillar (cookies / SSO / MFA) | v0.2 |
| DOM-drift router (cross-deploy resolver) | v0.1 |
| Cloud-hosted Husk | v0.3 |
| WebGL / WebRTC / WebAssembly / Gmail / Salesforce | inherited limitation |
| IndexedDB (affects Firebase Auth, Auth0 SPA, AWS Amplify) | inherited limitation; flagged in v0.2 |

## Quickstart

```sh
# Prerequisites: Node 20, pnpm 9, Python 3.11+
git clone https://github.com/NGHINAI/Husk
cd Husk

# Install lightpanda binary (M2: consume prebuilt; no Zig build needed for v0)
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

# Demo: drive lightpanda end-to-end
node ./orchestrator/dist/index.js demo https://example.com | head -50

# Or run the full HTTP/JSON-RPC server (M3 — runs until you Ctrl-C)
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
├── engine/         # Zig — forked lightpanda + our patches
├── orchestrator/   # TypeScript — Node binary, HTTP API, watchdog, action planner
├── sdk-ts/         # @husk/sdk — canonical TS client
├── sdk-py/         # husk-sdk — Python client
├── mcp/            # @husk/mcp — Model Context Protocol bridge
├── protocol/       # JSON-RPC + schemas (single source of truth)
├── examples/       # Three demo agents
└── docs/           # Quickstart, architecture, policy rules, specs
```

## Performance

Husk pre-warms a pool of lightpanda processes and elastically scales up to
the system's free-memory limit when concurrent sessions are requested.
Action results carry a `diff` field so agents avoid full re-snapshot
round-trips. `husk_batch_visit` lets agents fan out across many URLs in
a single tool call.

### 50-URL benchmark (measured 2026-05-15)

| Mode | Wall clock | Throughput | Avg payload | Notes |
|---|---|---|---|---|
| `pool` (N parallel sessions, full snapshot per URL) | **2.72s** | 18.36 URLs/sec | 43 KB | Baseline; BENCH_POOL_MAX=10 |
| `batch_visit` (terse snapshot per URL) | **4.00s** | 12.50 URLs/sec | 172 KB | Single tool call from the agent |
| `batch_visit` + extract (`.f4.my-3`) | **2.50s** | 19.97 URLs/sec | ~0 bytes | Targeted text only; null for non-matching pages |

Engine pool warmup (K=4 warm processes): ~125 ms. All three runs: 50/50 URLs succeeded.

The `batch_visit` + extract mode is fastest wall-clock because it short-circuits
after a single CSS query per page with no serialization overhead. The selector
`.f4.my-3` targets GitHub repo descriptions; pages that don't match (example.com,
HN home) return `null` text but still count as successful visits.

Reproduce:
```bash
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

**Note:** `extract` uses `Runtime.evaluate` on the current DOM. Lightpanda renders
static HTML but does not execute client-side JS hydration that some modern apps
rely on (e.g. GitHub's repo description div is React-rendered and won't be visible
via `extract` against lightpanda). For those targets, use server-rendered selectors
like `meta[name='description']` or wait for the Chrome adapter (v0.1+).

## Dynamic workflows (M13)

Husk now handles *any* workflow:

- **`husk_wait_for`** — wait for text, role+name, URL regex, network-idle, or CSS visibility (10s default timeout)
- **Intent-routed actions** — `husk_click`/`husk_type`/`husk_scroll`/`husk_upload` accept `{intent: "sign in button"}` instead of `{stable_id}`; deterministic AX resolution, ambiguity returns candidates
- **`husk_upload`** — `file_path` or `content_base64+filename` → `DOM.setFileInputFiles` (path-traversal sanitized)
- **Multi-selector `husk_extract`** — `{selectors: {price: ".price", title: "h1"}}` → one round-trip, returns `{key: text|null}` map
- **Page-readiness** — `goto` resolves on real `loadEventFired` + network-idle, not a fixed delay

### Watch UI

When `husk start` binds to 127.0.0.1, the orchestrator serves a live viewer at `http://127.0.0.1:PORT/watch`. `create_session` returns `{session_id, watch_url}` so agents can proactively offer the URL: "want to watch what I'm seeing?". Live AX tree on the left, color-coded event log on the right. No external assets, no framework.

## Snapshot Maximalism (M14)

`husk_snapshot` is now your one-stop context dump:

```
{
  root, url, mode,
  signature: { dom_hash, network_fingerprint },
  meta: { title, canonical, og, jsonld },
  forms: [{ fields, submit_text }],
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

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). All contributions require signing
the [CLA](./CLA.md).

## License

Core: AGPL v3 ([LICENSE](./LICENSE))
Examples and protocol schemas: MIT ([LICENSE-EXAMPLES](./LICENSE-EXAMPLES))
Upstream lightpanda: AGPL v3 (preserved in [engine/UPSTREAM_LICENSE](./engine/UPSTREAM_LICENSE))
