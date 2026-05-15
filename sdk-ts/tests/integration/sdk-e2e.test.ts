import { describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { Husk } from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const orchestratorPath = join(__dirname, "..", "..", "..", "orchestrator", "dist", "index.js");
const lightpandaBin = process.env.LIGHTPANDA_BIN;

async function findFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

const integrationOrSkip = (lightpandaBin && existsSync(orchestratorPath)) ? describe : describe.skip;

async function waitReady(husk: Husk, deadlineMs = 15_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const h = await husk.health();
      if (h.ok) return;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Orchestrator never became ready");
}

integrationOrSkip("sdk e2e — real husk start", () => {
  it("createSession → goto → snapshot → close against real orchestrator", async () => {
    const port = await findFreePort();
    const proc: ChildProcess = spawn(
      "node",
      [orchestratorPath, "start", "--port", String(port), "--log-level", "silent"],
      { env: { ...process.env, LIGHTPANDA_BIN: lightpandaBin }, stdio: "pipe" }
    );

    try {
      const husk = new Husk({ baseUrl: `http://127.0.0.1:${port}` });
      await waitReady(husk);

      const session = await husk.createSession();
      expect(session.id).toMatch(/^[0-9a-f-]{36}$/);

      await session.goto("https://example.com");
      const snap = await session.snapshot();
      expect(snap.count).toBeGreaterThan(0);
      expect(snap.root.r).toBe("RootWebArea");

      await session.close();
    } finally {
      proc.kill("SIGTERM");
      await new Promise((r) => proc.once("exit", () => r(null)));
    }
  }, 45_000);

  it("click on a non-existent stable_id returns a rejection envelope", async () => {
    const port = await findFreePort();
    const proc = spawn(
      "node",
      [orchestratorPath, "start", "--port", String(port), "--log-level", "silent"],
      { env: { ...process.env, LIGHTPANDA_BIN: lightpandaBin }, stdio: "pipe" }
    );

    try {
      const husk = new Husk({ baseUrl: `http://127.0.0.1:${port}` });
      await waitReady(husk);
      const session = await husk.createSession();
      await session.goto("https://example.com");
      await session.snapshot();

      const result = await session.click("button:totally-fake");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("element_not_found");
        expect(Array.isArray(result.candidates)).toBe(true);
      }
      await session.close();
    } finally {
      proc.kill("SIGTERM");
      await new Promise((r) => proc.once("exit", () => r(null)));
    }
  }, 45_000);
});
