/**
 * plannerSchema validation (task 1.3).
 */
import { describe, it, expect } from "vitest";
import { plannerSchema, type PlannerPlan } from "../../src/types/plan.js";

describe("plannerSchema (1.3)", () => {
  it("parses a fully-specified valid plan", () => {
    const obj = {
      summary: "Decompose the task.",
      subtasks: [
        {
          id: "step-1",
          title: "Add type",
          description: "Add the Severity type.",
          risk: "low",
          likelyFiles: ["types/alert.ts"],
          acceptanceCriteria: ["type exists"],
        },
      ],
      risks: ["DB migration is risky"],
      questions: ["Which thresholds?"],
    };
    const parsed = plannerSchema.parse(obj);
    const plan: PlannerPlan = parsed;
    expect(plan.subtasks).toHaveLength(1);
    expect(plan.subtasks[0].title).toBe("Add type");
  });

  it("rejects a plan with zero subtasks (min 1)", () => {
    const obj = { summary: "x", subtasks: [] };
    expect(plannerSchema.safeParse(obj).success).toBe(false);
  });

  it("rejects a subtask missing its title", () => {
    const obj = {
      summary: "x",
      subtasks: [{ description: "no title here" }],
    };
    expect(plannerSchema.safeParse(obj).success).toBe(false);
  });

  it("applies defaults to a partial subtask", () => {
    const obj = {
      summary: "x",
      subtasks: [{ title: "Just a title" }],
    };
    const parsed = plannerSchema.parse(obj);
    expect(parsed.subtasks[0].description).toBe("");
    expect(parsed.subtasks[0].likelyFiles).toEqual([]);
    expect(parsed.subtasks[0].acceptanceCriteria).toEqual([]);
    expect(parsed.risks).toEqual([]);
    expect(parsed.questions).toEqual([]);
  });
});
