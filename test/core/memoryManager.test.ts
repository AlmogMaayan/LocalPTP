import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryManager } from "../../src/core/memoryManager.js";
import { layout } from "../../src/utils/paths.js";
import { MEMORY_FILE_NAMES } from "../../src/templates/memory.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-mem-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("MemoryManager.scaffold", () => {
  it("5.2 creates all 14 files plus tasks/ and sessions/ dirs", async () => {
    const l = layout(tmp);
    const mm = new MemoryManager(l);
    const report = await mm.scaffold();

    expect(MEMORY_FILE_NAMES.length).toBe(14);
    for (const name of MEMORY_FILE_NAMES) {
      const stat = await fs.stat(l.memoryFile(name));
      expect(stat.isFile()).toBe(true);
    }
    expect((await fs.stat(l.tasksDir)).isDirectory()).toBe(true);
    expect((await fs.stat(l.sessionsDir)).isDirectory()).toBe(true);
    expect(report.created.length).toBe(14);
    expect(report.preserved.length).toBe(0);

    // each file carries the Last updated marker
    const body = await fs.readFile(l.memoryFile("project-brief.md"), "utf8");
    expect(body).toContain("Last updated:");
  });

  it("5.3 second scaffold preserves an edited file and lists it as preserved", async () => {
    const l = layout(tmp);
    const mm = new MemoryManager(l);
    await mm.scaffold();

    const edited = "# My edited brief\n\ncustom content\n";
    await fs.writeFile(l.memoryFile("project-brief.md"), edited, "utf8");

    const report = await mm.scaffold();
    expect(await fs.readFile(l.memoryFile("project-brief.md"), "utf8")).toBe(
      edited,
    );
    expect(report.preserved).toContain("project-brief.md");
    expect(report.created).not.toContain("project-brief.md");
  });

  it("5.4 report separates created vs preserved on a partial repo", async () => {
    const l = layout(tmp);
    const mm = new MemoryManager(l);
    // pre-create one file by hand
    await fs.mkdir(l.aiDir, { recursive: true });
    await fs.writeFile(l.memoryFile("decisions.md"), "pre-existing\n", "utf8");

    const report = await mm.scaffold();
    expect(report.preserved).toEqual(["decisions.md"]);
    expect(report.created).toHaveLength(13);
    expect(report.created).not.toContain("decisions.md");
  });
});
