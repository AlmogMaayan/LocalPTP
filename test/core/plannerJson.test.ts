/**
 * Planner JSON extraction (tasks 6.1–6.5).
 */
import { describe, it, expect } from "vitest";
import {
  extractAndValidatePlannerJson,
  UnparseablePlanError,
} from "../../src/core/plannerJson.js";

const validPlan = {
  summary: "Decompose.",
  subtasks: [
    { title: "Add type", risk: "low", likelyFiles: ["a.ts"] },
    { title: "Wire it up" },
  ],
  risks: ["a risk"],
  questions: ["a question"],
};

describe("strict parse (6.1)", () => {
  it("parses clean JSON", () => {
    const plan = extractAndValidatePlannerJson(JSON.stringify(validPlan));
    expect(plan.summary).toBe("Decompose.");
    expect(plan.subtasks).toHaveLength(2);
  });
});

describe("balanced-block extraction (6.2)", () => {
  it("extracts ```json-fenced JSON", () => {
    const raw = "Here is the plan:\n```json\n" + JSON.stringify(validPlan) + "\n```\nDone.";
    const plan = extractAndValidatePlannerJson(raw);
    expect(plan.subtasks).toHaveLength(2);
  });

  it("extracts prose-wrapped JSON with nested braces and strings", () => {
    const obj = {
      summary: "Has a } brace in a string",
      subtasks: [{ title: "Nested { object } in text", description: "x" }],
    };
    const raw = `The model says: ${JSON.stringify(obj)} — hope that helps!`;
    const plan = extractAndValidatePlannerJson(raw);
    expect(plan.summary).toContain("} brace");
    expect(plan.subtasks[0].title).toContain("Nested { object }");
  });
});

describe("unparseable (6.3)", () => {
  it("throws UnparseablePlanError on no JSON", () => {
    expect(() => extractAndValidatePlannerJson("I cannot help with that.")).toThrow(
      UnparseablePlanError,
    );
  });

  it("throws UnparseablePlanError on malformed JSON", () => {
    expect(() => extractAndValidatePlannerJson("{ summary: not valid json ")).toThrow(
      UnparseablePlanError,
    );
  });

  it("throws when the first balanced object is invalid (no later candidates tried)", () => {
    // First {...} is missing subtasks (invalid); a later valid one is ignored.
    const raw = `{"summary":"x"} then ${JSON.stringify(validPlan)}`;
    expect(() => extractAndValidatePlannerJson(raw)).toThrow(UnparseablePlanError);
  });
});

describe("normalization (6.4)", () => {
  it("normalizes ids to step-N regardless of model ids", () => {
    const obj = {
      summary: "x",
      subtasks: [
        { id: "foo", title: "a" },
        { id: "step-99", title: "b" },
        { title: "c" },
      ],
    };
    const plan = extractAndValidatePlannerJson(JSON.stringify(obj));
    expect(plan.subtasks.map((s) => s.id)).toEqual(["step-1", "step-2", "step-3"]);
  });

  it("normalizes risk to low|medium|high (default medium)", () => {
    const obj = {
      summary: "x",
      subtasks: [
        { title: "a", risk: "LOW" },
        { title: "b", risk: "critical" },
        { title: "c" },
      ],
    };
    const plan = extractAndValidatePlannerJson(JSON.stringify(obj));
    expect(plan.subtasks.map((s) => s.risk)).toEqual(["low", "medium", "medium"]);
  });

  it("defaults omitted optional fields", () => {
    const obj = { summary: "x", subtasks: [{ title: "a" }] };
    const plan = extractAndValidatePlannerJson(JSON.stringify(obj));
    expect(plan.subtasks[0].likelyFiles).toEqual([]);
    expect(plan.subtasks[0].acceptanceCriteria).toEqual([]);
    expect(plan.risks).toEqual([]);
    expect(plan.questions).toEqual([]);
  });
});
