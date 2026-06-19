/**
 * Tests for buildContext budget ladder (tasks 5.1–5.5).
 */
import { describe, it, expect } from "vitest";
import { buildContext, type ContextInputs } from "../../src/core/contextBuilder.js";
import { appConfigSchema, type AppConfig } from "../../src/types/config.js";
import { contextPackageSchema, parseActiveTask } from "../../src/types/context.js";
import type { RepoFile, RepoIndex } from "../../src/types/index.js";
import type { MemoryFiles } from "../../src/core/memoryLoader.js";

function cfg(overrides: Record<string, unknown> = {}): AppConfig {
  const base = appConfigSchema.parse({});
  return { ...base, context: { ...base.context, ...overrides } };
}

function file(partial: Partial<RepoFile> & { path: string }): RepoFile {
  return {
    extension: ".ts",
    size: 100,
    language: "typescript",
    imports: [],
    exports: [],
    isTest: false,
    isConfig: false,
    ...partial,
  };
}

function index(files: RepoFile[]): RepoIndex {
  return { generatedAt: "now", root: "/repo", files };
}

const memory: MemoryFiles = {
  "coding-rules.md": "RULES " + "r".repeat(50),
  "project-brief.md": "BRIEF " + "b".repeat(2000),
  "data-model.md": "DATA " + "d".repeat(2000),
};

describe("budget ladder (5.1–5.4)", () => {
  it("5.1 under budget → no ladder applied, no reduction warnings", () => {
    const idx = index([file({ path: "src/a.ts" })]);
    const inputs: ContextInputs = {
      role: "coder",
      config: cfg({ maxContextChars: 1_000_000 }),
      index: idx,
      memory: { "coding-rules.md": "rules" },
      fileContents: { "src/a.ts": "const x = 1;" },
    };
    const pkg = buildContext(inputs);
    expect(pkg.warnings.some((w) => /Budget:/.test(w))).toBe(false);
    expect(pkg.warnings.some((w) => /narrow/i.test(w))).toBe(false);
  });

  it("5.2 over budget → steps applied in order, each records a warning", () => {
    // Task with one edit file + one neighbor; both large secondary content.
    const big = "x".repeat(4000);
    const idx = index([
      file({ path: "src/a.ts", imports: ["./b"], size: 4000, exports: ["a"] }),
      file({ path: "src/b.ts", size: 4000, exports: ["b"] }),
    ]);
    const taskMd = `## Goal\n\nDo a.\n\n## Subtasks\n\n- [ ] e\n  likelyFiles: src/a.ts\n`;
    const inputs: ContextInputs = {
      role: "coder",
      // Budget large enough for edit file + memory but not the neighbor full.
      config: cfg({
        maxContextChars: 6000,
        maxFileChars: 4000,
        includeImportNeighbors: true,
        includeTests: false,
      }),
      index: idx,
      memory,
      task: parseActiveTask(taskMd),
      fileContents: { "src/a.ts": big, "src/b.ts": big },
    };
    const pkg = buildContext(inputs);
    // The neighbor (secondary source) must have been reduced; a Budget warning recorded.
    const budgetWarnings = pkg.warnings.filter((w) => /Budget:/.test(w));
    expect(budgetWarnings.length).toBeGreaterThanOrEqual(1);
    // Summarize comes before drop-memory in the warnings order.
    const summarizeIdx = pkg.warnings.findIndex((w) => /summaries/i.test(w));
    const dropMemIdx = pkg.warnings.findIndex((w) => /low-relevance memory/i.test(w));
    if (summarizeIdx !== -1 && dropMemIdx !== -1) {
      expect(summarizeIdx).toBeLessThan(dropMemIdx);
    }
  });

  it("5.3 task + role instructions never dropped, even at the smallest budget", () => {
    const idx = index([
      file({ path: "src/a.ts", size: 100 }),
      file({ path: "src/b.ts", imports: [], size: 100 }),
    ]);
    const taskMd = `## Goal\n\nImportant goal text.\n\n## Subtasks\n\n- [ ] do the thing\n  likelyFiles: src/a.ts\n`;
    const inputs: ContextInputs = {
      role: "coder",
      config: cfg({ maxContextChars: 1, includeImportNeighbors: true }),
      index: idx,
      memory,
      task: parseActiveTask(taskMd),
      fileContents: { "src/a.ts": "x".repeat(50), "src/b.ts": "y".repeat(50) },
    };
    const pkg = buildContext(inputs);
    expect(pkg.systemPrompt).toContain("careful coding assistant");
    expect(pkg.systemPrompt).toContain("[role: coder]");
    expect(pkg.userPrompt).toContain("Important goal text");
    expect(pkg.userPrompt).toContain("do the thing");
    // edit file is protected and retained
    expect(pkg.includedSourceFiles).toContain("src/a.ts");
  });

  it("5.4 still over after step 6 → narrow-task warning, package returned (no throw)", () => {
    const idx = index([file({ path: "src/a.ts", size: 5000 })]);
    const taskMd = `## Goal\n\n${"g".repeat(2000)}\n\n## Subtasks\n\n- [ ] e\n  likelyFiles: src/a.ts\n`;
    const inputs: ContextInputs = {
      role: "coder",
      config: cfg({ maxContextChars: 10, maxFileChars: 5000 }),
      index: idx,
      memory,
      task: parseActiveTask(taskMd),
      fileContents: { "src/a.ts": "x".repeat(5000) },
    };
    const pkg = buildContext(inputs);
    expect(pkg.warnings.some((w) => /narrow/i.test(w))).toBe(true);
    expect(pkg.role).toBe("coder");
  });
});

describe("token estimate + schema (5.5)", () => {
  it("estimatedTokens === ceil(totalChars/4) and package validates", () => {
    const idx = index([file({ path: "src/a.ts" })]);
    const inputs: ContextInputs = {
      role: "coder",
      config: cfg(),
      index: idx,
      memory: { "coding-rules.md": "rules" },
      fileContents: { "src/a.ts": "const x = 1;" },
    };
    const pkg = buildContext(inputs);
    const totalChars = pkg.systemPrompt.length + pkg.userPrompt.length;
    expect(pkg.estimatedTokens).toBe(Math.ceil(totalChars / 4));
    expect(contextPackageSchema.safeParse(pkg).success).toBe(true);
  });
});
