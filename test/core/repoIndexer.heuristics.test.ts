import { describe, it, expect } from "vitest";
import { isTestPath, isConfigPath, isBinary } from "../../src/core/repoIndexer.js";

describe("isTestPath", () => {
  it("2.1a *.test.ts -> true", () => {
    expect(isTestPath("a.test.ts")).toBe(true);
  });

  it("2.1b *.spec.js -> true", () => {
    expect(isTestPath("a.spec.js")).toBe(true);
  });

  it("2.1c __tests__/x.ts -> true", () => {
    expect(isTestPath("__tests__/x.ts")).toBe(true);
  });

  it("2.1d nested __tests__ -> true", () => {
    expect(isTestPath("src/__tests__/foo.ts")).toBe(true);
  });

  it("2.1e tests/x.py -> true", () => {
    expect(isTestPath("tests/x.py")).toBe(true);
  });

  it("2.1f plain a.ts -> false", () => {
    expect(isTestPath("a.ts")).toBe(false);
  });

  it("2.1g src/app.ts -> false", () => {
    expect(isTestPath("src/app.ts")).toBe(false);
  });
});

describe("isConfigPath", () => {
  it("2.2a tsconfig.json -> true", () => {
    expect(isConfigPath("tsconfig.json")).toBe(true);
  });

  it("2.2b .eslintrc -> true", () => {
    expect(isConfigPath(".eslintrc")).toBe(true);
  });

  it("2.2c vite.config.ts -> true", () => {
    expect(isConfigPath("vite.config.ts")).toBe(true);
  });

  it("2.2d root-level config.yml -> true", () => {
    expect(isConfigPath("config.yml")).toBe(true);
  });

  it("2.2e src/app.ts -> false", () => {
    expect(isConfigPath("src/app.ts")).toBe(false);
  });

  it("2.2f nested non-config src/data/values.yml -> false", () => {
    expect(isConfigPath("src/data/values.yml")).toBe(false);
  });
});

describe("isBinary", () => {
  it("2.3a known binary extension -> true", () => {
    expect(isBinary(".png", Buffer.from("normal text"))).toBe(true);
  });

  it("2.3b text buffer -> false", () => {
    expect(isBinary(".txt", Buffer.from("hello world\nfoo bar"))).toBe(false);
  });

  it("2.3c buffer with NUL byte -> true", () => {
    const buf = Buffer.from([104, 101, 108, 0, 111]); // "hel\0o"
    expect(isBinary(".ts", buf)).toBe(true);
  });

  it("2.3d unknown extension, clean text -> false", () => {
    expect(isBinary(".xyz", Buffer.from("plain text content"))).toBe(false);
  });
});
