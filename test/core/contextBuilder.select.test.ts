/**
 * Tests for buildContext selection pipeline (tasks 4.1–4.7).
 */
import { describe, it, expect } from "vitest";
import { buildContext, type ContextInputs } from "../../src/core/contextBuilder.js";
import { appConfigSchema, type AppConfig } from "../../src/types/config.js";
import { parseActiveTask } from "../../src/types/context.js";
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
  "coding-rules.md": "# Coding Rules\n\nBe careful.\n",
  "project-brief.md": "# Project Brief\n\nThing.\n",
  "data-model.md": "# Data Model\n",
};

function contents(...paths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of paths) out[p] = `// ${p}\nconst x = 1;\n`;
  return out;
}

describe("buildContext selection — no task (4.1)", () => {
  it("includes high-value memory + smallest-first source sample (caps honored) + no-task warning", () => {
    const idx = index([
      file({ path: "src/big.ts", size: 5000 }),
      file({ path: "src/small.ts", size: 50 }),
      file({ path: "src/mid.ts", size: 500 }),
      file({ path: "config.json", size: 10, isConfig: true, language: "json", extension: ".json" }),
    ]);
    const inputs: ContextInputs = {
      role: "coder",
      config: cfg({ maxFilesPerStep: 2 }),
      index: idx,
      memory,
      fileContents: contents("src/big.ts", "src/small.ts", "src/mid.ts"),
    };
    const pkg = buildContext(inputs);
    // smallest-first: small (50), mid (500); big excluded by cap of 2; config excluded.
    expect(pkg.includedSourceFiles).toEqual(["src/small.ts", "src/mid.ts"]);
    expect(pkg.includedMemoryFiles).toContain("coding-rules.md");
    expect(pkg.includedMemoryFiles).toContain("project-brief.md");
    expect(pkg.warnings.some((w) => /no active task/i.test(w))).toBe(true);
  });
});

describe("buildContext selection — task (4.2)", () => {
  it("likelyFiles become edit files (cap maxEditFilesPerStep); neighbors added when enabled; total capped at maxFilesPerStep", () => {
    const idx = index([
      file({ path: "src/a.ts", imports: ["./b", "./c"] }),
      file({ path: "src/b.ts" }),
      file({ path: "src/c.ts" }),
      file({ path: "src/d.ts" }),
    ]);
    const taskMd = `## Goal\n\nDo a.\n\n## Subtasks\n\n- [ ] edit a\n  likelyFiles: src/a.ts, src/d.ts\n`;
    const inputs: ContextInputs = {
      role: "coder",
      config: cfg({ maxEditFilesPerStep: 1, maxFilesPerStep: 2, includeImportNeighbors: true, includeTests: false }),
      index: idx,
      memory,
      task: parseActiveTask(taskMd),
      fileContents: contents("src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"),
    };
    const pkg = buildContext(inputs);
    // edit cap = 1 → only src/a.ts is an edit file. neighbors of a = b, c.
    // total cap = 2 → a + first neighbor (b, smallest-first / path asc).
    expect(pkg.includedSourceFiles).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("no neighbors when includeImportNeighbors is false", () => {
    const idx = index([
      file({ path: "src/a.ts", imports: ["./b"] }),
      file({ path: "src/b.ts" }),
    ]);
    const taskMd = `## Goal\n\nx\n\n## Subtasks\n\n- [ ] e\n  likelyFiles: src/a.ts\n`;
    const inputs: ContextInputs = {
      role: "coder",
      config: cfg({ includeImportNeighbors: false, includeTests: false }),
      index: idx,
      memory,
      task: parseActiveTask(taskMd),
      fileContents: contents("src/a.ts", "src/b.ts"),
    };
    const pkg = buildContext(inputs);
    expect(pkg.includedSourceFiles).toEqual(["src/a.ts"]);
  });
});

describe("buildContext direct tests (4.3)", () => {
  it("includes a direct test (basename-stem) only when includeTests; excludes unrelated tests", () => {
    const idx = index([
      file({ path: "src/Foo.ts" }),
      file({ path: "src/Foo.test.ts", isTest: true }),
      file({ path: "src/Unrelated.test.ts", isTest: true }),
    ]);
    const taskMd = `## Goal\n\nx\n\n## Subtasks\n\n- [ ] e\n  likelyFiles: src/Foo.ts\n`;
    const inputs: ContextInputs = {
      role: "coder",
      config: cfg({ includeTests: true, includeImportNeighbors: false }),
      index: idx,
      memory,
      task: parseActiveTask(taskMd),
      fileContents: contents("src/Foo.ts", "src/Foo.test.ts", "src/Unrelated.test.ts"),
    };
    const pkg = buildContext(inputs);
    expect(pkg.includedTestFiles).toEqual(["src/Foo.test.ts"]);
  });

  it("includes a direct test by import resolution", () => {
    const idx = index([
      file({ path: "src/bar.ts" }),
      file({ path: "test/bar_spec.ts", isTest: true, imports: ["../src/bar"] }),
    ]);
    const taskMd = `## Goal\n\nx\n\n## Subtasks\n\n- [ ] e\n  likelyFiles: src/bar.ts\n`;
    const inputs: ContextInputs = {
      role: "coder",
      config: cfg({ includeTests: true, includeImportNeighbors: false }),
      index: idx,
      memory,
      task: parseActiveTask(taskMd),
      fileContents: contents("src/bar.ts", "test/bar_spec.ts"),
    };
    const pkg = buildContext(inputs);
    expect(pkg.includedTestFiles).toEqual(["test/bar_spec.ts"]);
  });

  it("excludes tests when includeTests is false", () => {
    const idx = index([
      file({ path: "src/Foo.ts" }),
      file({ path: "src/Foo.test.ts", isTest: true }),
    ]);
    const taskMd = `## Goal\n\nx\n\n## Subtasks\n\n- [ ] e\n  likelyFiles: src/Foo.ts\n`;
    const inputs: ContextInputs = {
      role: "coder",
      config: cfg({ includeTests: false, includeImportNeighbors: false }),
      index: idx,
      memory,
      task: parseActiveTask(taskMd),
      fileContents: contents("src/Foo.ts", "src/Foo.test.ts"),
    };
    const pkg = buildContext(inputs);
    expect(pkg.includedTestFiles).toEqual([]);
  });
});

describe("buildContext binary exclusion (4.4)", () => {
  it("never selects binary entries (preview)", () => {
    const idx = index([
      file({ path: "src/a.ts", size: 100 }),
      file({ path: "assets/logo.png", size: 10, language: "binary", extension: ".png" }),
      file({ path: "assets/data.bin", size: 5, extension: ".bin", language: "unknown" }),
    ]);
    const inputs: ContextInputs = {
      role: "coder",
      config: cfg(),
      index: idx,
      memory,
      fileContents: contents("src/a.ts", "assets/logo.png", "assets/data.bin"),
    };
    const pkg = buildContext(inputs);
    expect(pkg.includedSourceFiles).toEqual(["src/a.ts"]);
  });
});

describe("buildContext conditional memory order (4.5)", () => {
  it("adds conditional memory in priority order; only files present in the map", () => {
    const mem: MemoryFiles = {
      "coding-rules.md": "rules",
      "test-plan.md": "tp",
      "project-brief.md": "pb",
      "data-model.md": "dm",
    };
    const inputs: ContextInputs = {
      role: "coder",
      config: cfg(),
      index: index([file({ path: "src/a.ts" })]),
      memory: mem,
      fileContents: contents("src/a.ts"),
    };
    const pkg = buildContext(inputs);
    // always (coding-rules) first, then conditional in priority order:
    // project-brief, data-model, test-plan (api-map etc. absent).
    expect(pkg.includedMemoryFiles).toEqual([
      "coding-rules.md",
      "project-brief.md",
      "data-model.md",
      "test-plan.md",
    ]);
  });
});

describe("buildContext empty index (4.6)", () => {
  it("memory-only package with a no-source-files warning, no crash", () => {
    const inputs: ContextInputs = {
      role: "coder",
      config: cfg(),
      index: index([]),
      memory,
      fileContents: {},
    };
    const pkg = buildContext(inputs);
    expect(pkg.includedSourceFiles).toEqual([]);
    expect(pkg.includedMemoryFiles).toContain("coding-rules.md");
    expect(pkg.warnings.some((w) => /no source files indexed/i.test(w))).toBe(true);
  });
});

describe("buildContext combined cap (4.7)", () => {
  it("combined source + test selection never exceeds maxFilesPerStep; edit first, then neighbors, then tests", () => {
    const idx = index([
      file({ path: "src/a.ts", imports: ["./b"], size: 10 }),
      file({ path: "src/b.ts", size: 20 }),
      file({ path: "src/a.test.ts", isTest: true, size: 5 }),
    ]);
    const taskMd = `## Goal\n\nx\n\n## Subtasks\n\n- [ ] e\n  likelyFiles: src/a.ts\n`;
    const inputs: ContextInputs = {
      role: "coder",
      config: cfg({ maxFilesPerStep: 2, includeImportNeighbors: true, includeTests: true }),
      index: idx,
      memory,
      task: parseActiveTask(taskMd),
      fileContents: contents("src/a.ts", "src/b.ts", "src/a.test.ts"),
    };
    const pkg = buildContext(inputs);
    // edit a (1) + neighbor b (2) fills the cap; the direct test gets no room.
    const combined = [...pkg.includedSourceFiles, ...pkg.includedTestFiles];
    expect(combined.length).toBe(2);
    expect(pkg.includedSourceFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(pkg.includedTestFiles).toEqual([]);
  });
});
