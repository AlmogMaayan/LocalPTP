/**
 * Tests for the Context Builder selection helpers (tasks 3.1–3.3).
 */
import { describe, it, expect } from "vitest";
import {
  importNeighbors,
  summarizeFile,
  snippetFile,
} from "../../src/core/contextBuilder.js";
import type { RepoFile, RepoIndex } from "../../src/types/index.js";

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

describe("importNeighbors (3.1)", () => {
  it("resolves './paths' to src/utils/paths.ts by suffix", () => {
    const idx = index([
      file({ path: "src/app.ts", imports: ["./utils/paths", "node:fs", "zod"] }),
      file({ path: "src/utils/paths.ts" }),
    ]);
    const neighbors = importNeighbors(["src/app.ts"], idx);
    expect(neighbors).toContain("src/utils/paths.ts");
  });

  it("ignores node builtins and packages", () => {
    const idx = index([
      file({ path: "src/app.ts", imports: ["node:fs", "fs", "commander", "zod"] }),
      file({ path: "src/utils/paths.ts" }),
    ]);
    const neighbors = importNeighbors(["src/app.ts"], idx);
    expect(neighbors).toEqual([]);
  });

  it("does not include the seed file itself", () => {
    const idx = index([
      file({ path: "src/a.ts", imports: ["./b"] }),
      file({ path: "src/b.ts", imports: ["./a"] }),
    ]);
    const neighbors = importNeighbors(["src/a.ts"], idx);
    expect(neighbors).toEqual(["src/b.ts"]);
  });
});

describe("summarizeFile (3.2)", () => {
  it("returns the index header plus the first 20 non-blank lines", () => {
    const body = Array.from({ length: 40 }, (_, i) =>
      i % 3 === 0 ? "" : `line ${i}`,
    ).join("\n");
    const entry = file({
      path: "src/big.ts",
      language: "typescript",
      size: 1234,
      exports: ["foo", "bar"],
    });
    const summary = summarizeFile(entry, body);
    expect(summary).toContain("src/big.ts");
    expect(summary).toContain("typescript");
    expect(summary).toContain("foo");
    expect(summary).toContain("bar");
    expect(summary).toContain("1234");
    // No blank lines counted; exactly 20 content lines retained.
    const contentLines = body
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .slice(0, 20);
    for (const l of contentLines) expect(summary).toContain(l);
    // The 21st content line is omitted.
    const allContent = body.split("\n").filter((l) => l.trim().length > 0);
    expect(summary).not.toContain(allContent[20]);
  });
});

describe("snippetFile (3.3)", () => {
  it("returns the first maxChars/2 chars plus a truncation marker", () => {
    const body = "x".repeat(1000);
    const snippet = snippetFile(body, 400);
    expect(snippet.startsWith("x".repeat(200))).toBe(true);
    expect(snippet).toContain("truncated");
    expect(snippet.length).toBeLessThan(body.length);
  });

  it("returns the body unchanged when already under the snippet size", () => {
    const body = "short";
    expect(snippetFile(body, 400)).toBe("short");
  });
});
