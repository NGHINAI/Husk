import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { startOrchestrator } from "../src/orchestrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const orchestratorPath = join(__dirname, "..", "..", "orchestrator", "dist", "index.js");
const lightpandaBin = process.env.LIGHTPANDA_BIN;

const integrationOrSkip = (lightpandaBin && existsSync(orchestratorPath)) ? describe : describe.skip;

integrationOrSkip("startOrchestrator", () => {
  it("spawns husk start, returns port, and stops cleanly", async () => {
    const orch = await startOrchestrator({
      orchestratorScript: orchestratorPath,
      lightpandaBin: lightpandaBin!,
      readyTimeoutMs: 15_000,
    });
    expect(orch.port).toBeGreaterThan(0);
    expect(orch.baseUrl).toBe(`http://127.0.0.1:${orch.port}`);
    await orch.stop();
  }, 30_000);

  it("times out / errors when orchestrator script does not exist", async () => {
    await expect(
      startOrchestrator({
        orchestratorScript: "/nonexistent",
        lightpandaBin: lightpandaBin!,
        readyTimeoutMs: 2_000,
      })
    ).rejects.toThrow();
  }, 10_000);
});
