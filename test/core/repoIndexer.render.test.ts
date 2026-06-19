import { describe, it, expect } from "vitest";
import { renderRepoMap, renderFileIndex } from "../../src/core/repoIndexer.js";
import type { RepoIndex } from "../../src/types/index.js";

function makeIndex(files: Array<Partial<import("../../src/types/index.js").RepoFile>>): RepoIndex {
  return {
    generatedAt: "2024-01-01T00:00:00.000Z",
    root: "/project",
    files: files.map((f, i) => ({
      path: `file${i}.ts`,
      extension: ".ts",
      size: 100,
      language: "typescript",
      isTest: false,
      isConfig: false,
      imports: [],
      exports: [],
      ...f,
    })),
  };
}

describe("renderRepoMap", () => {
  it("7.5a shows language counts", () => {
    const index = makeIndex([
      { language: "typescript" },
      { language: "typescript" },
      { language: "python", path: "main.py", extension: ".py" },
    ]);
    const result = renderRepoMap(index);
    expect(result).toContain("typescript: 2");
    expect(result).toContain("python: 1");
  });

  it("7.5b shows top-level directory breakdown", () => {
    const index = makeIndex([
      { path: "src/app.ts" },
      { path: "src/utils.ts" },
      { path: "tests/app.test.ts" },
    ]);
    const result = renderRepoMap(index);
    expect(result).toContain("src: 2");
    expect(result).toContain("tests: 1");
  });

  it("7.5c shows test and config counts", () => {
    const index = makeIndex([
      { isTest: true, path: "app.test.ts" },
      { isConfig: true, path: "tsconfig.json" },
      { path: "src/main.ts" },
    ]);
    const result = renderRepoMap(index);
    expect(result).toContain("Test files:");
    expect(result).toContain("1");
    expect(result).toContain("Config files:");
  });

  it("7.5d empty repo shows 0 files message", () => {
    const index = makeIndex([]);
    const result = renderRepoMap(index);
    expect(result).toContain("0 files");
  });
});

describe("renderFileIndex", () => {
  it("7.5e produces a table with headers", () => {
    const index = makeIndex([
      { path: "src/main.ts", language: "typescript", size: 200, isTest: false, isConfig: false },
    ]);
    const result = renderFileIndex(index);
    expect(result).toContain("path");
    expect(result).toContain("language");
    expect(result).toContain("src/main.ts");
    expect(result).toContain("typescript");
  });

  it("7.5f caps large fixture with +M more footer", () => {
    // Create 501 files (cap is 500)
    const files = Array.from({ length: 501 }, (_, i) => ({
      path: `src/file${String(i).padStart(4, "0")}.ts`,
    }));
    const index = makeIndex(files);
    const result = renderFileIndex(index);
    expect(result).toContain("+1 more (see index.json)");
  });

  it("7.5g no footer when under cap", () => {
    const index = makeIndex([{ path: "src/one.ts" }]);
    const result = renderFileIndex(index);
    expect(result).not.toContain("more");
  });
});
