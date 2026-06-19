import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { runInit } from "../../src/commands/init.js";
import { layout } from "../../src/utils/paths.js";
import { MEMORY_FILE_NAMES } from "../../src/templates/memory.js";
import { GITIGNORE_MARKER } from "../../src/utils/fs.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-init-"));
  tmp = await fs.realpath(tmp);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("runInit", () => {
  it("8.1 creates the full tree and touches no source file", async () => {
    await simpleGit(tmp).init();
    // a pre-existing source file we must not touch
    const srcFile = path.join(tmp, "app.ts");
    await fs.writeFile(srcFile, "export const x = 1;\n", "utf8");

    const report = await runInit({ cwd: tmp });
    const l = layout(tmp);

    for (const name of MEMORY_FILE_NAMES) {
      expect((await fs.stat(l.memoryFile(name))).isFile()).toBe(true);
    }
    expect((await fs.stat(l.tasksDir)).isDirectory()).toBe(true);
    expect((await fs.stat(l.sessionsDir)).isDirectory()).toBe(true);
    expect((await fs.stat(l.configFile)).isFile()).toBe(true);

    const gitignore = await fs.readFile(l.gitignoreFile, "utf8");
    expect(gitignore).toContain(GITIGNORE_MARKER);

    // source file untouched
    expect(await fs.readFile(srcFile, "utf8")).toBe("export const x = 1;\n");

    expect(report.memory.created).toHaveLength(14);
    expect(report.configCreated).toBe(true);
    expect(report.gitignoreAppended).toBe(true);
    expect(report.isGitRepo).toBe(true);
  });

  it("8.2 second init preserves an edited file and does not duplicate the gitignore stanza", async () => {
    await runInit({ cwd: tmp });
    const l = layout(tmp);
    const edited = "# edited decisions\n";
    await fs.writeFile(l.memoryFile("decisions.md"), edited, "utf8");

    const report = await runInit({ cwd: tmp });
    expect(await fs.readFile(l.memoryFile("decisions.md"), "utf8")).toBe(edited);
    expect(report.memory.preserved).toContain("decisions.md");
    expect(report.configCreated).toBe(false);
    expect(report.gitignoreAppended).toBe(false);

    const gitignore = await fs.readFile(l.gitignoreFile, "utf8");
    expect(gitignore.split(GITIGNORE_MARKER).length - 1).toBe(1);
  });

  it("8.3 in a non-git dir warns but still creates the scaffold and succeeds", async () => {
    const report = await runInit({ cwd: tmp });
    const l = layout(tmp);
    expect(report.isGitRepo).toBe(false);
    expect((await fs.stat(l.configFile)).isFile()).toBe(true);
    expect((await fs.stat(l.memoryFile("project-brief.md"))).isFile()).toBe(true);
  });
});
