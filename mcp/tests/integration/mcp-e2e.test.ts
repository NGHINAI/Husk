import { describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mcpEntry = join(__dirname, "..", "..", "dist", "index.js");
const orchestratorEntry = join(__dirname, "..", "..", "..", "orchestrator", "dist", "index.js");
const lightpandaBin = process.env.LIGHTPANDA_BIN;

const integrationOrSkip = (lightpandaBin && existsSync(mcpEntry) && existsSync(orchestratorEntry))
  ? describe
  : describe.skip;

function jsonRpcRequest(id: number, method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}

async function readUntilId(proc: ChildProcess, id: number, timeoutMs = 30_000): Promise<{ result?: unknown; error?: { message: string } }> {
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(timer);
        proc.stdout?.off("data", onData);
        reject(new Error(`Timeout waiting for response id=${id}`));
      }
    }, 500);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      for (;;) {
        const nl = buf.indexOf("\n");
        if (nl < 0) break;
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } };
          if (msg.id === id) {
            clearInterval(timer);
            proc.stdout?.off("data", onData);
            return resolve({ result: msg.result, error: msg.error });
          }
        } catch { /* ignore non-JSON lines */ }
      }
    };
    proc.stdout?.on("data", onData);
  });
}

integrationOrSkip("mcp e2e — real husk-mcp subprocess", () => {
  it("initialize → tools/list → tools/call husk_create_session → husk_goto → husk_snapshot", async () => {
    const proc = spawn("node", [mcpEntry], {
      env: { ...process.env, LIGHTPANDA_BIN: lightpandaBin, HUSK_ORCHESTRATOR: orchestratorEntry },
      stdio: "pipe",
    });
    proc.stderr?.on("data", (d) => process.stderr.write(d));

    try {
      proc.stdin?.write(jsonRpcRequest(1, "initialize"));
      const init = await readUntilId(proc, 1);
      expect((init.result as { serverInfo?: { name?: string } }).serverInfo?.name).toBe("husk-mcp");

      proc.stdin?.write(jsonRpcRequest(2, "tools/list"));
      const list = await readUntilId(proc, 2);
      const tools = (list.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
      expect(tools).toContain("husk_goto");
      expect(tools).toContain("husk_click");

      proc.stdin?.write(jsonRpcRequest(3, "tools/call", { name: "husk_create_session", arguments: {} }));
      const create = await readUntilId(proc, 3);
      const createContent = JSON.parse(((create.result as { content: Array<{ text: string }> }).content[0].text));
      const sessionId = (createContent as { session_id: string }).session_id;
      expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

      proc.stdin?.write(jsonRpcRequest(4, "tools/call", {
        name: "husk_goto",
        arguments: { session_id: sessionId, url: "https://example.com" },
      }));
      const gotoRes = await readUntilId(proc, 4);
      const gotoContent = JSON.parse(((gotoRes.result as { content: Array<{ text: string }> }).content[0].text));
      expect(gotoContent).toEqual({ ok: true });

      proc.stdin?.write(jsonRpcRequest(5, "tools/call", {
        name: "husk_snapshot",
        arguments: { session_id: sessionId },
      }));
      const snap = await readUntilId(proc, 5);
      const snapContent = JSON.parse(((snap.result as { content: Array<{ text: string }> }).content[0].text));
      expect(snapContent.v).toBe(1);
      expect(snapContent.count).toBeGreaterThan(0);
    } finally {
      proc.kill("SIGTERM");
      await new Promise((r) => proc.once("exit", () => r(null)));
    }
  }, 90_000);

  it("husk_click on a non-existent stable_id returns a rejection envelope through the MCP boundary", async () => {
    const proc = spawn("node", [mcpEntry], {
      env: { ...process.env, LIGHTPANDA_BIN: lightpandaBin, HUSK_ORCHESTRATOR: orchestratorEntry },
      stdio: "pipe",
    });
    proc.stderr?.on("data", (d) => process.stderr.write(d));
    try {
      proc.stdin?.write(jsonRpcRequest(1, "initialize"));
      await readUntilId(proc, 1);

      proc.stdin?.write(jsonRpcRequest(2, "tools/call", { name: "husk_create_session", arguments: {} }));
      const create = await readUntilId(proc, 2);
      const sessionId = JSON.parse(((create.result as { content: Array<{ text: string }> }).content[0].text)).session_id;

      proc.stdin?.write(jsonRpcRequest(3, "tools/call", {
        name: "husk_goto",
        arguments: { session_id: sessionId, url: "https://example.com" },
      }));
      await readUntilId(proc, 3);

      proc.stdin?.write(jsonRpcRequest(4, "tools/call", {
        name: "husk_snapshot",
        arguments: { session_id: sessionId },
      }));
      await readUntilId(proc, 4);

      proc.stdin?.write(jsonRpcRequest(5, "tools/call", {
        name: "husk_click",
        arguments: { session_id: sessionId, stable_id: "button:totally-fake" },
      }));
      const click = await readUntilId(proc, 5);
      const env = JSON.parse(((click.result as { content: Array<{ text: string }> }).content[0].text));
      expect(env.ok).toBe(false);
      expect(env.reason).toBe("element_not_found");
    } finally {
      proc.kill("SIGTERM");
      await new Promise((r) => proc.once("exit", () => r(null)));
    }
  }, 90_000);
});
