/**
 * Integration tests for `localcoder index` command (task 8.1–8.3).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runIndex, type IndexResult } from "../../src/commands/index.js";
import { appConfigSchema } from "../../src/types/config.js";
import { repoIndexSchema } from "../../src/types/index.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-idx-cmd-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeFile(dir: string, rel: string, content: string): Promise<void> {
  const full = path.join(dir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

describe("runIndex", () => {
  it("8.1 writes index.json, updates marker sections, prints summary", async () => {
    await writeFile(tmp, "src/app.ts", "export const x = 1;");
    await writeFile(tmp, "ai/repo-map.md", "# Repo Map\n\nUser notes.\n");
    await writeFile(tmp, "ai/file-index.md", "# File Index\n\nUser notes.\n");

    const result = await runIndex({ cwd: tmp });

    // index.json written
    const indexPath = path.join(tmp, ".ai-orchestrator", "index.json");
    const raw = await fs.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    const validation = repoIndexSchema.safeParse(parsed);
    expect(validation.success).toBe(true);

    // Has at least one file (src/app.ts)
    expect(parsed.files.some((f: { path: string }) => f.path === "src/app.ts")).toBe(true);

    // Marker sections updated
    const repoMap = await fs.readFile(path.join(tmp, "ai/repo-map.md"), "utf8");
    expect(repoMap).toContain("<!-- BEGIN localcoder:index -->");
    expect(repoMap).toContain("User notes."); // preserved

    const fileIndex = await fs.readFile(path.join(tmp, "ai/file-index.md"), "utf8");
    expect(fileIndex).toContain("<!-- BEGIN localcoder:index -->");
    expect(fileIndex).toContain("User notes."); // preserved

    // Summary returned
    expect(result.indexed).toBeGreaterThanOrEqual(1);
    expect(typeof result.ignored).toBe("number");
    expect(typeof result.durationMs).toBe("number");
  });

  it("8.2 second run is idempotent for content outside markers", async () => {
    await writeFile(tmp, "src/app.ts", "export const x = 1;");
    await writeFile(tmp, "ai/repo-map.md", "# Repo Map\n\nMy notes.\n");
    await writeFile(tmp, "ai/file-index.md", "# File Index\n\nMy notes.\n");

    await runIndex({ cwd: tmp });
    const repoMap1 = await fs.readFile(path.join(tmp, "ai/repo-map.md"), "utf8");

    await runIndex({ cwd: tmp });
    const repoMap2 = await fs.readFile(path.join(tmp, "ai/repo-map.md"), "utf8");

    // Content outside the markers is preserved identically
    expect(repoMap2).toContain("My notes.");

    // The user-text outside should not duplicate
    const noteCount = (repoMap2.match(/My notes\./g) ?? []).length;
    expect(noteCount).toBe(1);
  });

  it("8.3 --json flag returns structured summary", async () => {
    await writeFile(tmp, "src/app.ts", "export const x = 1;");

    const result = await runIndex({ cwd: tmp, json: true });

    expect(result).toHaveProperty("indexed");
    expect(result).toHaveProperty("ignored");
    expect(result).toHaveProperty("durationMs");
    expect(typeof result.indexed).toBe("number");
    expect(typeof result.durationMs).toBe("number");
  });

  it("8.4 does not modify source files", async () => {
    await writeFile(tmp, "src/app.ts", "export const x = 1;\n");
    const origContent = await fs.readFile(path.join(tmp, "src/app.ts"), "utf8");

    await runIndex({ cwd: tmp });

    const afterContent = await fs.readFile(path.join(tmp, "src/app.ts"), "utf8");
    expect(afterContent).toBe(origContent);
  });

  it("8.5 non-git directory: warns but still indexes", async () => {
    // No git init - plain directory
    await writeFile(tmp, "src/main.ts", "const x = 1;");

    const warnings: string[] = [];
    const result = await runIndex({ cwd: tmp, onWarning: (w) => warnings.push(w) });

    expect(result.indexed).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => /not a git/i.test(w))).toBe(true);
  });
});
