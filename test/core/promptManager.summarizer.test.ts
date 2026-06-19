/**
 * Task 3.1 — summarizer prompt template.
 * Tests: change-type constraint + brevity instruction in the prompt.
 */
import { describe, it, expect } from "vitest";
import { getPrompt } from "../../src/core/promptManager.js";

describe("getPrompt('summarizer') (3.1)", () => {
  it("3.1a is registered without throwing", () => {
    expect(() => getPrompt("summarizer")).not.toThrow();
  });

  it("3.1b system prompt lists the allowed change types", () => {
    const { system } = getPrompt("summarizer");
    expect(system).toContain("file-responsibility");
    expect(system).toContain("api-behavior");
    expect(system).toContain("data-model");
    expect(system).toContain("architectural-decision");
    expect(system).toContain("external-integration");
    expect(system).toContain("testing-process");
    expect(system).toContain("risk");
  });

  it("3.1c system prompt includes brevity/conciseness instruction", () => {
    const { system } = getPrompt("summarizer");
    // Should mention concise/brevity or one line per entry
    const lower = system.toLowerCase();
    expect(lower).toMatch(/concis|brief|one line/);
  });

  it("3.1d renderUser wraps the context string", () => {
    const { renderUser } = getPrompt("summarizer");
    const ctx = "## Task\n\nGoal: Fix the bug";
    const user = renderUser(ctx);
    expect(user).toContain(ctx);
    // Should instruct to return the structured output
    expect(user).toContain("sessionUpdate");
    expect(user).toContain("memoryUpdates");
    expect(user).toContain("nextStep");
  });

  it("3.1e system prompt constrains changeType to ONLY the allowed values", () => {
    const { system } = getPrompt("summarizer");
    // Should state that ONLY these change types are allowed
    expect(system.toUpperCase()).toContain("ONLY");
  });
});
