/**
 * Reviewer + test-fixer prompt templates + registration (task 1.3).
 */
import { describe, it, expect } from "vitest";
import { getPrompt } from "../../src/core/promptManager.js";

describe("getPrompt('reviewer') (1.3)", () => {
  it("returns { system, renderUser } embedding the §10.1 base rules", () => {
    const p = getPrompt("reviewer");
    expect(typeof p.system).toBe("string");
    expect(typeof p.renderUser).toBe("function");
    expect(p.system).toContain("careful coding assistant");
  });

  it("instructs §3.12: review the diff and return the report JSON keys", () => {
    const p = getPrompt("reviewer");
    const text = p.system + "\n" + p.renderUser("[role: reviewer]\ndiff");
    expect(text).toContain("summary");
    expect(text).toContain("blocking");
    expect(text).toContain("nonBlocking");
    expect(text).toContain("missingTests");
    expect(text).toContain("scopeCreep");
    expect(text).toContain("recommendation");
    // Advisory / does not edit code.
    expect(text.toLowerCase()).toMatch(/review|advisory/);
  });
});

describe("getPrompt('test-fixer') (1.3)", () => {
  it("returns { system, renderUser } embedding the §10.1 base rules", () => {
    const p = getPrompt("test-fixer");
    expect(typeof p.system).toBe("string");
    expect(typeof p.renderUser).toBe("function");
    expect(p.system).toContain("careful coding assistant");
  });

  it("instructs §3.11: return a minimal unified diff to fix the failure", () => {
    const p = getPrompt("test-fixer");
    const text = p.system + "\n" + p.renderUser("[role: test-fixer]\nfailure");
    expect(text).toMatch(/unified diff/i);
    expect(text.toLowerCase()).toMatch(/minimal|smallest/);
    expect(text.toLowerCase()).toContain("test");
  });
});
