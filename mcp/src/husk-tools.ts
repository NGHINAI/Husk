import type { McpTool, McpToolCallResult } from "./types.js";

/** Husk's MCP protocol version pinned to the version supported by upstream lightpanda. */
const HUSK_MCP_PROTOCOL = "2024-11-05";

/** Husk MCP package version. Bumped on each release; mirrored from package.json. */
const HUSK_VERSION = "0.0.0";

/**
 * Tools defined natively by Husk (not forwarded to lightpanda).
 *
 * For v0 there is only one: `husk_version`. M5+M6 will add more
 * (e.g., `husk_set_policy`, `husk_diff`, `husk_resolve_stable_id`).
 */
export const HUSK_NATIVE_TOOLS: McpTool[] = [
  {
    name: "husk_version",
    description:
      "Husk — return version information about the Husk MCP shim and the underlying lightpanda engine it wraps.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

const HUSK_NATIVE_NAMES = new Set(HUSK_NATIVE_TOOLS.map((t) => t.name));

export function isHuskNativeTool(name: string): boolean {
  return HUSK_NATIVE_NAMES.has(name);
}

export interface HuskNativeContext {
  /** Version of lightpanda actually being proxied (discovered at startup). */
  lightpandaVersion: string;
}

export async function callHuskNativeTool(
  name: string,
  _args: unknown,
  ctx: HuskNativeContext
): Promise<McpToolCallResult> {
  switch (name) {
    case "husk_version": {
      const payload = {
        husk: HUSK_VERSION,
        lightpanda: ctx.lightpandaVersion,
        protocol: HUSK_MCP_PROTOCOL,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
      };
    }
    default:
      return {
        content: [{ type: "text", text: `Unknown Husk-native tool: ${name}` }],
        isError: true,
      };
  }
}
