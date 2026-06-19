import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureDir,
  writeIfAbsent,
  readIfExists,
  appendGitignoreStanza,
  GITIGNORE_MARKER,
} from "../../src/utils/fs.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-fs-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("ensureDir", () => {
  it("creates nested dirs idempotently", async () => {
    const dir = path.join(tmp, "a", "b", "c");
    await ensureDir(dir);
    await ensureDir(dir); // second call must not throw
    const stat = await fs.stat(dir);
    expect(stat.isDirectory()).toBe(true);
  });
});

describe("writeIfAbsent", () => {
  it("writes when the file is absent and returns true", async () => {
    const file = path.join(tmp, "new.txt");
    const created = await writeIfAbsent(file, "hello");
    expect(created).toBe(true);
    expect(await fs.readFile(file, "utf8")).toBe("hello");
  });

  it("does not clobber an existing file and returns false", async () => {
    const file = path.join(tmp, "exists.txt");
    await fs.writeFile(file, "original", "utf8");
    const created = await writeIfAbsent(file, "replacement");
    expect(created).toBe(false);
    expect(await fs.readFile(file, "utf8")).toBe("original");
  });
});

describe("readIfExists", () => {
  it("returns undefined when the file is missing", async () => {
    expect(await readIfExists(path.join(tmp, "nope.txt"))).toBeUndefined();
  });

  it("returns content when the file exists", async () => {
    const file = path.join(tmp, "there.txt");
    await fs.writeFile(file, "data", "utf8");
    expect(await readIfExists(file)).toBe("data");
  });
});

describe("appendGitignoreStanza", () => {
  it("creates .gitignore with the stanza when absent", async () => {
    const file = path.join(tmp, ".gitignore");
    const appended = await appendGitignoreStanza(file);
    expect(appended).toBe(true);
    const content = await fs.readFile(file, "utf8");
    expect(content).toContain(GITIGNORE_MARKER);
    expect(content).toContain(".ai-orchestrator/logs/");
  });

  it("does not double-append when the marker is already present", async () => {
    const file = path.join(tmp, ".gitignore");
    await appendGitignoreStanza(file);
    const appended = await appendGitignoreStanza(file);
    expect(appended).toBe(false);
    const content = await fs.readFile(file, "utf8");
    const occurrences = content.split(GITIGNORE_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });

  it("appends to an existing .gitignore preserving prior content", async () => {
    const file = path.join(tmp, ".gitignore");
    await fs.writeFile(file, "node_modules\n", "utf8");
    await appendGitignoreStanza(file);
    const content = await fs.readFile(file, "utf8");
    expect(content).toContain("node_modules");
    expect(content).toContain(GITIGNORE_MARKER);
  });
});
