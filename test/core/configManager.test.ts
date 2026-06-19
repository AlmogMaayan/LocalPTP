import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { ConfigManager } from "../../src/core/configManager.js";

let tmp: string;
let configFile: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-cfg-"));
  configFile = path.join(tmp, ".ai-orchestrator", "config.yml");
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("ConfigManager.load", () => {
  it("4.1 returns full defaults when no file exists", async () => {
    const cm = new ConfigManager(configFile);
    const cfg = await cm.load();
    expect(cfg.model.provider).toBe("lmstudio");
    expect(cfg.model.baseUrl).toBe("http://localhost:1234/v1");
    expect(cfg.model.model).toBe("qwen/qwen3.6-27b");
    expect(cfg.model.temperature).toBe(0.2);
    expect(cfg.model.maxContextTokens).toBe(32768);
    expect(cfg.context.maxContextChars).toBe(120000);
    expect(cfg.safety.requireApproval).toBe(true);
    expect(cfg.commands.test).toBe("npm test");
    expect(cfg.ignore).toContain("node_modules");
  });

  it("4.2 merges a user config setting only model.temperature over defaults", async () => {
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(
      configFile,
      yaml.dump({ model: { temperature: 0.9 } }),
      "utf8",
    );
    const cm = new ConfigManager(configFile);
    const cfg = await cm.load();
    expect(cfg.model.temperature).toBe(0.9);
    // everything else keeps defaults
    expect(cfg.model.baseUrl).toBe("http://localhost:1234/v1");
    expect(cfg.context.maxFilesPerStep).toBe(12);
  });

  it("4.3 maps snake_case YAML to camelCase TS on load", async () => {
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(
      configFile,
      yaml.dump({ model: { base_url: "http://x:9/v1", max_context_tokens: 8000 } }),
      "utf8",
    );
    const cm = new ConfigManager(configFile);
    const cfg = await cm.load();
    expect(cfg.model.baseUrl).toBe("http://x:9/v1");
    expect(cfg.model.maxContextTokens).toBe(8000);
  });

  it("4.4 invalid value yields a path + hint, not a raw stack", async () => {
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(
      configFile,
      yaml.dump({ model: { temperature: "hot" } }),
      "utf8",
    );
    const cm = new ConfigManager(configFile);
    await expect(cm.load()).rejects.toThrow(/model\.temperature/);
    await expect(cm.load()).rejects.toThrow(/expected number|Expected number/i);
  });
});

describe("ConfigManager.write round-trip (snake_case on disk)", () => {
  it("4.3 writes snake_case keys to disk", async () => {
    const cm = new ConfigManager(configFile);
    const cfg = await cm.load();
    await cm.write(cfg);
    const raw = await fs.readFile(configFile, "utf8");
    expect(raw).toContain("base_url");
    expect(raw).toContain("max_context_tokens");
    expect(raw).not.toContain("baseUrl");
    expect(raw).not.toContain("maxContextTokens");
  });
});

describe("ConfigManager.set", () => {
  it("4.5 coerces and writes a valid dotted key; later load reflects it", async () => {
    const cm = new ConfigManager(configFile);
    await cm.set("model.baseUrl", "http://localhost:5000/v1");
    const cfg = await new ConfigManager(configFile).load();
    expect(cfg.model.baseUrl).toBe("http://localhost:5000/v1");
  });

  it("4.5 coerces booleans and numbers", async () => {
    const cm = new ConfigManager(configFile);
    await cm.set("safety.requireApproval", "false");
    await cm.set("model.temperature", "0.7");
    const cfg = await new ConfigManager(configFile).load();
    expect(cfg.safety.requireApproval).toBe(false);
    expect(cfg.model.temperature).toBe(0.7);
  });

  it("4.5 does NOT write an invalid value", async () => {
    const cm = new ConfigManager(configFile);
    await expect(cm.set("model.temperature", "hot")).rejects.toThrow(
      /model\.temperature/,
    );
    // file must not contain the invalid value
    const raw = await fs.readFile(configFile, "utf8").catch(() => "");
    expect(raw).not.toContain("hot");
  });
});

describe("ConfigManager.writeDefaultIfAbsent", () => {
  it("writes defaults when absent and reports created, preserves when present", async () => {
    const cm = new ConfigManager(configFile);
    expect(await cm.writeDefaultIfAbsent()).toBe(true);
    expect(await cm.writeDefaultIfAbsent()).toBe(false);
  });
});
