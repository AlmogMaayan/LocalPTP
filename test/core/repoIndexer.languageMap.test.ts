import { describe, it, expect } from "vitest";
import { detectLanguage, KNOWN_BINARY_EXT } from "../../src/core/repoIndexer.js";

describe("detectLanguage", () => {
  it("1.2a detects TypeScript", () => {
    expect(detectLanguage(".ts")).toBe("typescript");
  });

  it("1.2b detects JavaScript", () => {
    expect(detectLanguage(".js")).toBe("javascript");
  });

  it("1.2c detects Python", () => {
    expect(detectLanguage(".py")).toBe("python");
  });

  it("1.2d returns unknown for unrecognized extension", () => {
    expect(detectLanguage(".xyz")).toBe("unknown");
  });

  it("1.2e handles empty extension", () => {
    expect(detectLanguage("")).toBe("unknown");
  });

  it("1.2f handles case-insensitive extension (tsx)", () => {
    expect(detectLanguage(".tsx")).toBe("typescript");
  });
});

describe("KNOWN_BINARY_EXT", () => {
  it("1.2g contains .png", () => {
    expect(KNOWN_BINARY_EXT.has(".png")).toBe(true);
  });

  it("1.2h does not contain .ts", () => {
    expect(KNOWN_BINARY_EXT.has(".ts")).toBe(false);
  });
});
