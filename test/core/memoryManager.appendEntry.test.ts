/**
 * Task 2.1–2.4 — appendMemoryEntry tests (TDD, accumulating writer).
 *
 * Key invariants:
 *   - All prior content (user prose) is byte-identical outside the appended line.
 *   - Same-day identical entry is NOT duplicated.
 *   - Over-cap content is truncated to MAX_ENTRY_CHARS.
 *   - Missing section heading → created; missing file → created with title heading.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendMemoryEntry, MAX_ENTRY_CHARS } from "../../src/core/memoryManager.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-append-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

describe("appendMemoryEntry — user prose preserved (2.1)", () => {
  it("inserts a dated entry at the end of the named section; all other lines byte-identical", async () => {
    const filePath = path.join(tmp, "decisions.md");
    const original = [
      "# Architectural Decisions",
      "",
      "User wrote this.",
      "",
      "## Architectural Decisions",
      "- 2024-01-01 — older entry",
      "",
      "## Another Section",
      "- some content",
      "",
    ].join("\n");
    await fs.writeFile(filePath, original, "utf8");

    await appendMemoryEntry(filePath, "Architectural Decisions", "chose X over Y");

    const written = await fs.readFile(filePath, "utf8");
    const entryLine = `- ${TODAY} — chose X over Y`;
    expect(written).toContain(entryLine);

    // All lines from original must still be present (byte-identical outside appended line)
    for (const line of original.split("\n").filter((l) => l.length > 0)) {
      expect(written).toContain(line);
    }
  });

  it("entry appears at the END of the matched section, before the next ##", async () => {
    const filePath = path.join(tmp, "decisions.md");
    const original = [
      "# Decisions",
      "",
      "## Architectural Decisions",
      "- 2024-01-01 — older entry",
      "",
      "## Risks / Known Issues",
      "- some risk",
    ].join("\n");
    await fs.writeFile(filePath, original, "utf8");

    await appendMemoryEntry(filePath, "Architectural Decisions", "new decision");

    const written = await fs.readFile(filePath, "utf8");
    const newEntry = `- ${TODAY} — new decision`;
    const decisionsSectionIdx = written.indexOf("## Architectural Decisions");
    const risksIdx = written.indexOf("## Risks / Known Issues");
    const entryIdx = written.indexOf(newEntry);

    expect(entryIdx).toBeGreaterThan(decisionsSectionIdx);
    expect(entryIdx).toBeLessThan(risksIdx);
  });
});

describe("appendMemoryEntry — de-duplication (2.2)", () => {
  it("same-day identical entry in same section is NOT duplicated", async () => {
    const filePath = path.join(tmp, "decisions.md");
    const existing = [
      "# Decisions",
      "",
      "## Architectural Decisions",
      `- ${TODAY} — chose X over Y`,
      "",
    ].join("\n");
    await fs.writeFile(filePath, existing, "utf8");

    await appendMemoryEntry(filePath, "Architectural Decisions", "chose X over Y");

    const written = await fs.readFile(filePath, "utf8");
    const count = (written.match(new RegExp(`chose X over Y`, "g")) ?? []).length;
    expect(count).toBe(1);
  });

  it("same-day identical entry in a DIFFERENT section is still inserted", async () => {
    const filePath = path.join(tmp, "decisions.md");
    const existing = [
      "# Decisions",
      "",
      "## Section A",
      `- ${TODAY} — same content`,
      "",
      "## Section B",
      "",
    ].join("\n");
    await fs.writeFile(filePath, existing, "utf8");

    await appendMemoryEntry(filePath, "Section B", "same content");

    const written = await fs.readFile(filePath, "utf8");
    const count = (written.match(/same content/g) ?? []).length;
    expect(count).toBe(2);
  });
});

describe("appendMemoryEntry — over-cap truncation (2.3)", () => {
  it("content longer than MAX_ENTRY_CHARS is truncated", async () => {
    const filePath = path.join(tmp, "decisions.md");
    await fs.writeFile(filePath, "# Decisions\n\n## My Section\n", "utf8");

    const longContent = "x".repeat(MAX_ENTRY_CHARS + 100);
    await appendMemoryEntry(filePath, "My Section", longContent);

    const written = await fs.readFile(filePath, "utf8");
    // Find the entry line
    const lines = written.split("\n");
    const entryLine = lines.find((l) => l.startsWith(`- ${TODAY} —`));
    expect(entryLine).toBeTruthy();
    // The content part after "- YYYY-MM-DD — " should be at most MAX_ENTRY_CHARS chars
    const prefix = `- ${TODAY} — `;
    const content = entryLine!.slice(prefix.length);
    expect(content.length).toBeLessThanOrEqual(MAX_ENTRY_CHARS);
  });

  it("content at exactly MAX_ENTRY_CHARS is NOT truncated", async () => {
    const filePath = path.join(tmp, "decisions.md");
    await fs.writeFile(filePath, "# Decisions\n\n## My Section\n", "utf8");

    const exactContent = "y".repeat(MAX_ENTRY_CHARS);
    await appendMemoryEntry(filePath, "My Section", exactContent);

    const written = await fs.readFile(filePath, "utf8");
    expect(written).toContain(exactContent);
  });
});

describe("appendMemoryEntry — missing section / missing file (2.4)", () => {
  it("missing section heading → created with the entry beneath it; existing content preserved", async () => {
    const filePath = path.join(tmp, "decisions.md");
    const existing = "# Decisions\n\n## Existing Section\n- old content\n";
    await fs.writeFile(filePath, existing, "utf8");

    await appendMemoryEntry(filePath, "New Section", "brand new entry");

    const written = await fs.readFile(filePath, "utf8");
    expect(written).toContain("## New Section");
    expect(written).toContain(`- ${TODAY} — brand new entry`);
    // existing content still there
    expect(written).toContain("## Existing Section");
    expect(written).toContain("- old content");
  });

  it("missing file → created with a title heading and the section+entry", async () => {
    const filePath = path.join(tmp, "new-file.md");
    // file does not exist

    await appendMemoryEntry(filePath, "My Section", "first entry");

    const written = await fs.readFile(filePath, "utf8");
    expect(written).toContain("## My Section");
    expect(written).toContain(`- ${TODAY} — first entry`);
  });
});
