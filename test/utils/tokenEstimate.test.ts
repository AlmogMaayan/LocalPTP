import { describe, it, expect } from "vitest";
import { estimateTokens } from "../../src/utils/tokenEstimate.js";

describe("estimateTokens", () => {
  it("returns 1 for a 4-char string", () => {
    expect(estimateTokens("abcd")).toBe(1);
  });

  it("uses ceil(len/4)", () => {
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("a".repeat(8))).toBe(2);
  });
});
