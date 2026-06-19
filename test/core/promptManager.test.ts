/**
 * Prompt Manager + planner template (task 5.1).
 */
import { describe, it, expect } from "vitest";
import { getPrompt } from "../../src/core/promptManager.js";

describe("getPrompt (5.1)", () => {
  it("planner returns { system, renderUser } embedding §10.1 rules", () => {
    const p = getPrompt("planner");
    expect(typeof p.system).toBe("string");
    expect(typeof p.renderUser).toBe("function");
    // §10.1 base rules embedded.
    expect(p.system).toContain("careful coding assistant");
    expect(p.system).toContain("Work in small, safe patches.");
  });

  it("planner user framing requires the §3.9 JSON keys", () => {
    const p = getPrompt("planner");
    const user = p.renderUser("[role: planner]\nGoal: do the thing");
    expect(user).toContain("[role: planner]");
    // The §3.9 planner JSON keys must be instructed.
    for (const key of [
      "summary",
      "subtasks",
      "id",
      "title",
      "description",
      "risk",
      "likelyFiles",
      "acceptanceCriteria",
      "risks",
      "questions",
    ]) {
      expect(user).toContain(key);
    }
  });

  it("retriever is unregistered (out for MVP) and throws", () => {
    expect(() => getPrompt("retriever")).toThrow();
  });
});
