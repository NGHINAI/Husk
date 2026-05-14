# @husk/mcp

Model Context Protocol bridge for Husk.

When complete (Milestone 6), this package will let MCP-aware clients
(Claude Desktop, Cursor, Continue, Windsurf, etc.) use Husk as a browser
tool with one config line:

```json
{
  "mcpServers": {
    "husk": { "command": "npx", "args": ["-y", "@husk/mcp"] }
  }
}
```

## Status

Milestone 1 placeholder. See [docs/mcp-setup.md](../docs/mcp-setup.md).
