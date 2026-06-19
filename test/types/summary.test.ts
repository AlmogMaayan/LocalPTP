/**
 * Task 1.1 — summarizerSchema (zod) + SummarizerOutput.
 * Tests: valid object parses; partial fills defaults.
 */
import { describe, it, expect } from "vitest";
import { summarizerSchema } from "../../src/types/summary.js";

describe("summarizerSchema", () => {
  it("1.1a parses a fully-formed object", () => {
    const result = summarizerSchema.parse({
      sessionUpdate: {
        currentState: "completed work",
        filesChanged: ["src/foo.ts"],
        decisions: ["Used X over Y"],
        risks: ["potential breakage"],
      },
      memoryUpdates: [
        { changeType: "architectural-decision", content: "chose X" },
      ],
      nextStep: "Deploy to staging",
    });
    expect(result.sessionUpdate.currentState).toBe("completed work");
    expect(result.sessionUpdate.filesChanged).toEqual(["src/foo.ts"]);
    expect(result.memoryUpdates).toHaveLength(1);
    expect(result.memoryUpdates[0].changeType).toBe("architectural-decision");
    expect(result.nextStep).toBe("Deploy to staging");
  });

  it("1.1b fills defaults for omitted optional fields", () => {
    const result = summarizerSchema.parse({});
    expect(result.sessionUpdate.currentState).toBe("");
    expect(result.sessionUpdate.filesChanged).toEqual([]);
    expect(result.sessionUpdate.decisions).toEqual([]);
    expect(result.sessionUpdate.risks).toEqual([]);
    expect(result.memoryUpdates).toEqual([]);
    expect(result.nextStep).toBe("");
  });

  it("1.1c fills defaults for partial sessionUpdate", () => {
    const result = summarizerSchema.parse({
      sessionUpdate: { currentState: "partial" },
    });
    expect(result.sessionUpdate.currentState).toBe("partial");
    expect(result.sessionUpdate.filesChanged).toEqual([]);
    expect(result.sessionUpdate.decisions).toEqual([]);
    expect(result.sessionUpdate.risks).toEqual([]);
  });

  it("1.1d rejects memoryUpdates with missing content", () => {
    const result = summarizerSchema.safeParse({
      memoryUpdates: [{ changeType: "risk" }],
    });
    expect(result.success).toBe(false);
  });
});
