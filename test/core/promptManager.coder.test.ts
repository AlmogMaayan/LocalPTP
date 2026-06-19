/**
 * Coder prompt template + Prompt Manager registration (task 1.2).
 */
import { describe, it, expect } from "vitest";
import { getPrompt } from "../../src/core/promptManager.js";

describe("getPrompt('coder') (1.2)", () => {
  it("returns { system, renderUser } embedding the §10.1 base rules", () => {
    const p = getPrompt("coder");
    expect(typeof p.system).toBe("string");
    expect(typeof p.renderUser).toBe("function");
    // §10.1 base rules embedded.
    expect(p.system).toContain("careful coding assistant");
    expect(p.system).toContain("Work in small, safe patches.");
  });

  it("instructs §10.2: return ONLY a unified diff, else a needs_context JSON", () => {
    const p = getPrompt("coder");
    const text = p.system + "\n" + p.renderUser("[role: coder]\nGoal: do the thing");
    // Unified-diff-only instruction.
    expect(text).toMatch(/unified diff/i);
    // The needs_context escape hatch.
    expect(text).toContain("needs_context");
  });
});
