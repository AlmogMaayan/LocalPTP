import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runConfig } from "../../src/commands/config.js";
import { layout } from "../../src/utils/paths.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-cfgcmd-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("runConfig show", () => {
  it("9.1 prints the full merged config when no key given", async () => {
    const result = await runConfig({ cwd: tmp });
    expect(result.mode).toBe("show");
    expect(result.value).toMatchObject({
      model: { provider: "lmstudio" },
      context: {},
      safety: {},
      commands: {},
    });
  });

  it("9.1 prints the model sub-tree for `config model`", async () => {
    const result = await runConfig({ cwd: tmp, key: "model" });
    expect(result.mode).toBe("show");
    expect(result.value).toMatchObject({ provider: "lmstudio" });
    expect(result.value).not.toHaveProperty("context");
  });

  it("redacts api_key on a show", async () => {
    const result = await runConfig({ cwd: tmp, key: "model" });
    expect((result.value as { apiKey: string }).apiKey).toBe("[REDACTED]");
  });
});

describe("runConfig set", () => {
  it("9.2 set then later show reflects the new value (disk round-trip)", async () => {
    await runConfig({ cwd: tmp, key: "model.baseUrl", value: "http://localhost:5000/v1" });
    // verify on disk uses snake_case
    const l = layout(tmp);
    const raw = await fs.readFile(l.configFile, "utf8");
    expect(raw).toContain("base_url: http://localhost:5000/v1");

    const result = await runConfig({ cwd: tmp, key: "model" });
    expect((result.value as { baseUrl: string }).baseUrl).toBe(
      "http://localhost:5000/v1",
    );
  });

  it("does not write an invalid value", async () => {
    await expect(
      runConfig({ cwd: tmp, key: "model.temperature", value: "hot" }),
    ).rejects.toThrow(/model\.temperature/);
  });
});
