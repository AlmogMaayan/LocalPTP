import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { updateMarkerSection } from "../../src/core/memoryManager.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-marker-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("updateMarkerSection", () => {
  it("7.1 replaces only the inner region, preserves text outside markers", async () => {
    const file = path.join(tmp, "repo-map.md");
    const original = [
      "# My Repo Map",
      "",
      "User notes here.",
      "",
      "<!-- BEGIN localcoder:index -->",
      "old content",
      "<!-- END localcoder:index -->",
      "",
      "More user notes.",
    ].join("\n");
    await fs.writeFile(file, original, "utf8");

    await updateMarkerSection(file, "index", "new content");

    const result = await fs.readFile(file, "utf8");
    expect(result).toContain("User notes here.");
    expect(result).toContain("More user notes.");
    expect(result).toContain("new content");
    expect(result).not.toContain("old content");
    expect(result).toContain("<!-- BEGIN localcoder:index -->");
    expect(result).toContain("<!-- END localcoder:index -->");
  });

  it("7.2 markers absent: appends a fresh block without removing existing content", async () => {
    const file = path.join(tmp, "file-index.md");
    const original = "# File Index\n\nExisting content here.\n";
    await fs.writeFile(file, original, "utf8");

    await updateMarkerSection(file, "index", "new section");

    const result = await fs.readFile(file, "utf8");
    expect(result).toContain("Existing content here.");
    expect(result).toContain("<!-- BEGIN localcoder:index -->");
    expect(result).toContain("new section");
    expect(result).toContain("<!-- END localcoder:index -->");
  });

  it("7.2b file does not exist: creates with marker block", async () => {
    const file = path.join(tmp, "new-file.md");

    await updateMarkerSection(file, "index", "fresh content");

    const result = await fs.readFile(file, "utf8");
    expect(result).toContain("<!-- BEGIN localcoder:index -->");
    expect(result).toContain("fresh content");
    expect(result).toContain("<!-- END localcoder:index -->");
  });

  it("7.3 duplicate BEGIN markers: replaces first complete block, does not crash", async () => {
    const file = path.join(tmp, "dup.md");
    const original = [
      "<!-- BEGIN localcoder:index -->",
      "block one",
      "<!-- END localcoder:index -->",
      "middle text",
      "<!-- BEGIN localcoder:index -->",
      "block two",
      "<!-- END localcoder:index -->",
    ].join("\n");
    await fs.writeFile(file, original, "utf8");

    await updateMarkerSection(file, "index", "replacement");

    const result = await fs.readFile(file, "utf8");
    expect(result).toContain("replacement");
    expect(result).not.toContain("block one");
  });

  it("7.1b second call is idempotent for content outside markers", async () => {
    const file = path.join(tmp, "idempotent.md");
    const original = "Before\n<!-- BEGIN localcoder:index -->\nold\n<!-- END localcoder:index -->\nAfter\n";
    await fs.writeFile(file, original, "utf8");

    await updateMarkerSection(file, "index", "body");
    const first = await fs.readFile(file, "utf8");

    await updateMarkerSection(file, "index", "body");
    const second = await fs.readFile(file, "utf8");

    expect(second).toContain("Before");
    expect(second).toContain("After");
    expect(first).toBe(second);
  });
});
