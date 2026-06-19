/**
 * Tests for the static coder system prompt (task 2.1).
 */
import { describe, it, expect } from "vitest";
import { CODER_SYSTEM_PROMPT } from "../../src/core/prompts.js";

describe("CODER_SYSTEM_PROMPT (2.1)", () => {
  it("contains the §10.1 rules", () => {
    expect(CODER_SYSTEM_PROMPT).toContain("Work in small, safe patches");
    expect(CODER_SYSTEM_PROMPT).toContain(
      "request exact files instead of guessing",
    );
    expect(CODER_SYSTEM_PROMPT).toContain(
      "You are a careful coding assistant",
    );
  });
});
