# engine/spike/

**THROWAWAY DIRECTORY** — this code exists only to support the M2 spike
([report](../../docs/superpowers/spikes/2026-05-14-m2-lightpanda-audit/SPIKE-REPORT.md)).

Once Plan #3 (the real M2 engine patches) lands, this directory will be
deleted or restructured. Do not depend on any file here for production work.

## Contents

- `fixture.html` — a static test page used by the proof-of-concept
- `snapshot-poc.mjs` — Node script that drives lightpanda via CDP and prints
  a spec-§5.2-style semantic snapshot via `Accessibility.getFullAXTree`
- `.scratch/` — gitignored: prebuilt lightpanda binary (downloaded from GH releases),
  captured outputs, PID files

## Running

```sh
# 1. Download the prebuilt binary (one-time)
mkdir -p engine/spike/.scratch
gh release download 0.3.0 --repo lightpanda-io/browser \
  --pattern 'lightpanda-aarch64-macos' \
  --output engine/spike/.scratch/lightpanda
chmod +x engine/spike/.scratch/lightpanda

# 2. Serve the fixture page
cd engine/spike
python3 -m http.server 8765 --bind 127.0.0.1 &
HTTP_PID=$!

# 3. Start lightpanda CDP server
.scratch/lightpanda serve --host 127.0.0.1 --port 9222 &
LP_PID=$!
sleep 2

# 4. Install deps and run the PoC
npm install
node snapshot-poc.mjs

# 5. Cleanup
kill $LP_PID $HTTP_PID
```

## Alternative: MCP path (Shape D)

Lightpanda also ships a stdio MCP server with 20 tools (`goto`, `semantic_tree`,
`interactiveElements`, `click`, `fill`, etc.). This is even simpler to drive:

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"poc","version":"0.1"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"goto","arguments":{"url":"http://127.0.0.1:8765/fixture.html"}}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"semantic_tree","arguments":{}}}' \
  | .scratch/lightpanda mcp
```

## What was learned

1. `Accessibility.getFullAXTree` returns 57 nodes for the fixture page (15 016 bytes raw).
2. Disabled state is signalled by the **absence** of the `focusable` property on
   interactive roles — not by an explicit `disabled` flag.
3. Passthrough roles (`none`, `generic`, `StaticText`, `InlineTextBox`) wrap the
   tree but carry no semantic signal — the adapter must skip-through them.
4. After skip-through filtering and spec-§5.2 transformation the snapshot is
   **1 635 bytes** — 89.1 % smaller than the raw CDP payload.
5. `fetch --dump semantic_tree` is an even richer alternative: includes `xpath`,
   `isDisabled`, `isInteractive`, `checked`, `value`, and `attributes` per node
   (8 355 bytes for the same fixture).
