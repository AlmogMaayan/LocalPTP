/**
 * Integration tests for `localptp context` (tasks 6.1–6.4).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runContext, formatContextResult } from "../../src/commands/context.js";
import { contextPackageSchema } from "../../src/types/context.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-ctx-cmd-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeFile(dir: string, rel: string, content: string): Promise<void> {
  const full = path.join(dir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

interface IndexFile {
  path: string;
  extension: string;
  size: number;
  language: string;
  imports: string[];
  exports: string[];
  isTest: boolean;
  isConfig: boolean;
}

async function writeIndex(dir: string, files: IndexFile[]): Promise<void> {
  const idx = { generatedAt: "now", root: dir, files };
  await writeFile(dir, ".ai-orchestrator/index.json", JSON.stringify(idx, null, 2));
}

function entry(p: string, overrides: Partial<IndexFile> = {}): IndexFile {
  return {
    path: p,
    extension: path.extname(p),
    size: 100,
    language: "typescript",
    imports: [],
    exports: [],
    isTest: false,
    isConfig: false,
    ...overrides,
  };
}

describe("runContext (6.1)", () => {
  it("prints Role/Memory/Source/Tests/Estimated tokens + no-task warning; no model call", async () => {
    await writeFile(tmp, "src/app.ts", "export const x = 1;\n");
    await writeFile(tmp, "ai/coding-rules.md", "# Coding Rules\n\nBe careful.\n");
    await writeIndex(tmp, [entry("src/app.ts")]);

    const result = await runContext({ cwd: tmp });
    const text = formatContextResult(result);

    expect(text).toContain("Role: coder");
    expect(text).toContain("Memory:");
    expect(text).toContain("Source:");
    expect(text).toContain("Tests:");
    expect(text).toMatch(/Estimated tokens: .* \/ /);
    expect(text).toMatch(/no active task/i);
    expect(result.pkg.includedSourceFiles).toContain("src/app.ts");
  });
});

describe("runContext missing index (6.2)", () => {
  it("throws an actionable error with a non-zero exit code", async () => {
    await writeFile(tmp, "ai/coding-rules.md", "# Rules\n");
    let err: unknown;
    try {
      await runContext({ cwd: tmp });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/localptp index/);
    expect((err as { exitCode?: number }).exitCode).toBe(1);
  });
});

describe("runContext deleted indexed file (6.3)", () => {
  it("omits a deleted file + collects a re-run-index warning; no crash", async () => {
    // Index references two files; only one exists on disk.
    await writeFile(tmp, "src/present.ts", "export const x = 1;\n");
    await writeFile(tmp, "ai/coding-rules.md", "# Rules\n");
    await writeIndex(tmp, [entry("src/present.ts", { size: 10 }), entry("src/gone.ts", { size: 5 })]);

    const result = await runContext({ cwd: tmp });
    expect(result.pkg.includedSourceFiles).toContain("src/present.ts");
    expect(result.pkg.includedSourceFiles).not.toContain("src/gone.ts");
    expect(result.pkg.warnings.some((w) => /indexed file missing/i.test(w))).toBe(true);
  });
});

describe("runContext --json / --role (6.4)", () => {
  it("returns a schema-valid package; --role planner changes the role header", async () => {
    await writeFile(tmp, "src/app.ts", "export const x = 1;\n");
    await writeFile(tmp, "ai/coding-rules.md", "# Rules\n");
    await writeIndex(tmp, [entry("src/app.ts")]);

    const result = await runContext({ cwd: tmp, role: "planner" });
    expect(contextPackageSchema.safeParse(result.pkg).success).toBe(true);
    expect(result.pkg.role).toBe("planner");
    const text = formatContextResult(result);
    expect(text).toContain("Role: planner");
  });
});
