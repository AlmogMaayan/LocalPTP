import { describe, it, expect } from "vitest";
import { repoIndexSchema } from "../../src/types/index.js";

describe("repoIndexSchema", () => {
  it("1.1a parses a valid RepoIndex object", () => {
    const valid = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      root: "/home/user/project",
      files: [
        {
          path: "src/index.ts",
          extension: ".ts",
          size: 100,
          language: "typescript",
          isTest: false,
          isConfig: false,
          imports: ["./foo"],
          exports: ["bar"],
        },
      ],
    };
    const result = repoIndexSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("1.1b parses a file entry with defaults for imports/exports", () => {
    const valid = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      root: "/home/user/project",
      files: [
        {
          path: "src/index.ts",
          extension: ".ts",
          size: 100,
          language: "typescript",
          isTest: false,
          isConfig: false,
        },
      ],
    };
    const result = repoIndexSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files[0].imports).toEqual([]);
      expect(result.data.files[0].exports).toEqual([]);
    }
  });

  it("1.1c rejects a file entry missing `path`", () => {
    const invalid = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      root: "/home/user/project",
      files: [
        {
          extension: ".ts",
          size: 100,
          language: "typescript",
          isTest: false,
          isConfig: false,
        },
      ],
    };
    const result = repoIndexSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("1.1d summary is optional", () => {
    const withSummary = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      root: "/home/user/project",
      files: [
        {
          path: "src/index.ts",
          extension: ".ts",
          size: 100,
          language: "typescript",
          isTest: false,
          isConfig: false,
          summary: "Entry point",
        },
      ],
    };
    const result = repoIndexSchema.safeParse(withSummary);
    expect(result.success).toBe(true);
  });
});
