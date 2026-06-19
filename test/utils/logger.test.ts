import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogger, redactSecrets } from "../../src/utils/logger.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-log-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("redactSecrets", () => {
  it("redacts a bearer token", () => {
    expect(redactSecrets("Authorization: Bearer sk-abc123")).not.toContain(
      "sk-abc123",
    );
    expect(redactSecrets("Authorization: Bearer sk-abc123")).toContain(
      "[REDACTED]",
    );
  });

  it("redacts an api_key value", () => {
    const out = redactSecrets('api_key: "lm-studio-secret-xyz"');
    expect(out).not.toContain("lm-studio-secret-xyz");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts apiKey camelCase", () => {
    const out = redactSecrets("apiKey=topsecret");
    expect(out).not.toContain("topsecret");
  });
});

describe("logger file output", () => {
  it("writes a dated log file and redacts secrets in written lines", async () => {
    const logsDir = path.join(tmp, "logs");
    const logger = createLogger({ logsDir });
    await logger.info("calling model with Bearer sk-supersecret-token");

    const files = await fs.readdir(logsDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.log$/);

    const content = await fs.readFile(path.join(logsDir, files[0]), "utf8");
    expect(content).not.toContain("sk-supersecret-token");
    expect(content).toContain("[REDACTED]");
  });

  it("does not write .env content to the log", async () => {
    const logsDir = path.join(tmp, "logs");
    const logger = createLogger({ logsDir });
    await logger.info("loaded env DATABASE_URL=postgres://user:p@ss@host/db");
    const files = await fs.readdir(logsDir);
    const content = await fs.readFile(path.join(logsDir, files[0]), "utf8");
    expect(content).not.toContain("postgres://user:p@ss@host/db");
  });

  it("only writes debug lines when debug is enabled", async () => {
    const logsDir = path.join(tmp, "logs");
    const quiet = createLogger({ logsDir, debug: false });
    await quiet.debug("verbose details");
    let files = await fs.readdir(logsDir).catch(() => []);
    const quietContent = files.length
      ? await fs.readFile(path.join(logsDir, files[0]), "utf8")
      : "";
    expect(quietContent).not.toContain("verbose details");

    const loud = createLogger({ logsDir, debug: true });
    await loud.debug("verbose details");
    files = await fs.readdir(logsDir);
    const loudContent = await fs.readFile(
      path.join(logsDir, files[0]),
      "utf8",
    );
    expect(loudContent).toContain("verbose details");
  });
});
