/**
 * Tests for the /ai memory loader (task 2.2).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadMemoryFiles } from "../../src/core/memoryLoader.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-mem-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("loadMemoryFiles (2.2)", () => {
  it("reads /ai/*.md into a name→content map", async () => {
    await fs.mkdir(path.join(tmp, "ai"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "ai", "coding-rules.md"),
      "# Coding Rules\n\nBe careful.\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(tmp, "ai", "project-brief.md"),
      "# Project Brief\n",
      "utf8",
    );
    // A non-markdown file is ignored.
    await fs.writeFile(path.join(tmp, "ai", "notes.txt"), "ignored", "utf8");
    // A subdirectory (tasks/) is not flattened into the map.
    await fs.mkdir(path.join(tmp, "ai", "tasks"), { recursive: true });
    await fs.writeFile(path.join(tmp, "ai", "tasks", "t1.md"), "task", "utf8");

    const mem = await loadMemoryFiles(tmp);

    expect(mem["coding-rules.md"]).toContain("Be careful");
    expect(mem["project-brief.md"]).toContain("Project Brief");
    expect(mem["notes.txt"]).toBeUndefined();
    expect(mem["t1.md"]).toBeUndefined();
  });

  it("returns an empty map (no crash) when /ai is missing", async () => {
    const mem = await loadMemoryFiles(tmp);
    expect(mem).toEqual({});
  });
});
