# Husk MCP Setup

The `@husk/mcp` package exposes Husk to Model Context Protocol clients
(Claude Desktop, Cursor, Continue, Windsurf, anything that speaks MCP).
This is the primary agent-facing surface for Husk in v0.

Under the hood, `husk-mcp` spawns the upstream lightpanda binary in its
own MCP mode and proxies between your MCP client and lightpanda — adding
Husk-branded tool names, prepending "Husk — " to descriptions, and
shipping the `husk_version` native tool. In M5+M6 the proxy gains
watchdog enforcement and stable-ID resolution. The MCP server config you
write today will not change as those layer in.

## Prerequisites

- Node 20 LTS (matches the rest of Husk)
- A prebuilt lightpanda binary discoverable via `LIGHTPANDA_BIN` env var
  or `lightpanda` on `PATH`. Download from
  https://github.com/lightpanda-io/browser/releases (asset names:
  `lightpanda-aarch64-macos`, `lightpanda-x86_64-macos`,
  `lightpanda-aarch64-linux`, `lightpanda-x86_64-linux`).

## Install Husk locally (until npm publish in M7)

```sh
git clone https://github.com/NGHINAI/Husk
cd Husk
pnpm install
make all
# Verify the MCP binary built
node ./mcp/dist/index.js version
```

## Configure your MCP client

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) and add a `husk` server entry:

```json
{
  "mcpServers": {
    "husk": {
      "command": "node",
      "args": ["/absolute/path/to/Husk/mcp/dist/index.js"],
      "env": {
        "LIGHTPANDA_BIN": "/absolute/path/to/lightpanda"
      }
    }
  }
}
```

Replace `/absolute/path/to/Husk` with your clone's location and
`/absolute/path/to/lightpanda` with the binary you downloaded.

Restart Claude Desktop. You should see Husk tools available:
`husk_goto`, `husk_snapshot`, `husk_click`, `husk_fill`,
`husk_scroll`, `husk_wait_for_selector`, `husk_version`, and others.

### Cursor

Cursor uses the same `mcpServers` config shape. Edit your Cursor
settings and add the same entry.

### After M7 (npm publish)

When `@husk/mcp` is published to npm, the config simplifies to:

```json
{
  "mcpServers": {
    "husk": {
      "command": "npx",
      "args": ["-y", "@husk/mcp"],
      "env": { "LIGHTPANDA_BIN": "/absolute/path/to/lightpanda" }
    }
  }
}
```

## Verify the install

Once Claude Desktop / Cursor restarts, ask the agent to call
`husk_version`. The response should include the Husk version, the
lightpanda binary path, and the MCP protocol version (`2024-11-05`).

If you don't see Husk tools listed, check `~/Library/Logs/Claude/`
(macOS) for MCP startup errors. The most common issue is `LIGHTPANDA_BIN`
pointing at a non-executable path.

## What's in v0 vs what's coming

v0 (today):
- All 20 lightpanda tools exposed under Husk names
- "Husk — " prefix on every tool description
- `husk_version` native tool

v0.1 / M5 (the watchdog wedge):
- Per-session policy YAML loading via a `husk_set_policy` tool
- Pre-action sanity checks (element-exists / visible / enabled) intercepted in the proxy
- Watchdog rejection envelopes with structured `reason` + `candidates`

v0.2 / M6 polish:
- `husk_stable_id` tool that returns spec-§5.1 stable IDs
- `husk_diff` tool that returns mutation deltas
- Cookie / SSO / MFA helpers from the auth pillar
