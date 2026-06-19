/**
 * `runLoop` driver with an injected scripted step core (tasks 5.1-5.3).
 */
import { describe, it, expect } from "vitest";
import { runLoop, ITERATION_SLACK } from "../../src/core/runLoop.js";
import { appConfigSchema, type AppConfig } from "../../src/types/config.js";
import { ModelClientError } from "../../src/types/model.js";
import type { StepOutcome } from "../../src/types/run.js";
import type { TestResult } from "../../src/types/test.js";

function config(maxFixAttempts = 2): AppConfig {
  return appConfigSchema.parse({ safety: { maxFailedFixAttempts: maxFixAttempts } });
}

function passing(): TestResult[] {
  return [{ command: "t", exitCode: 0, stdout: "", stderr: "", durationMs: 1 }];
}

function applied(id: string): StepOutcome {
  return { subtaskId: id, applied: true, testResults: passing(), fixAttempts: 0 };
}

const doneOutcome: StepOutcome = {
  subtaskId: null,
  applied: false,
  testResults: [],
  fixAttempts: 0,
};

/** A scripted step: returns each outcome in order; repeats the last. */
function scriptedStep(outcomes: StepOutcome[]): () => Promise<StepOutcome> {
  let i = 0;
  return async () => {
    const o = outcomes[Math.min(i, outcomes.length - 1)];
    i += 1;
    return o;
  };
}

describe("runLoop — completes all subtasks (5.1)", () => {
  it("all-applied script then done → processes every subtask, acceptance reported", async () => {
    const lines: string[] = [];
    const result = await runLoop({
      config: config(),
      pendingCount: 3,
      print: (l) => lines.push(l),
      step: scriptedStep([applied("step-1"), applied("step-2"), applied("step-3"), doneOutcome]),
    });
    expect(result.stopReason).toBe("acceptance-met");
    expect(result.applied).toBe(3);
    // A progress line per applied step.
    expect(lines.filter((l) => /^Step \d/.test(l)).length).toBe(4);
    expect(lines.some((l) => /Acceptance criteria met/.test(l))).toBe(true);
    expect(lines.some((l) => /summarize/.test(l))).toBe(true);
  });
});

describe("runLoop — stops at a stop condition (5.2)", () => {
  it("a scripted stop outcome → loop stops at that step and prints the reason", async () => {
    const lines: string[] = [];
    const risky: StepOutcome = {
      subtaskId: "step-2",
      applied: false,
      stopReason: "risky-change",
      testResults: [],
      fixAttempts: 0,
    };
    const result = await runLoop({
      config: config(),
      pendingCount: 5,
      print: (l) => lines.push(l),
      step: scriptedStep([applied("step-1"), risky, applied("step-3")]),
    });
    expect(result.stopReason).toBe("risky-change");
    // Stopped after the second step (one applied before).
    expect(result.applied).toBe(1);
    expect(lines.some((l) => /Stopping run — risky-change/.test(l))).toBe(true);
  });

  it("a thrown model error → mapped to model-unavailable", async () => {
    const lines: string[] = [];
    const result = await runLoop({
      config: config(),
      pendingCount: 2,
      print: (l) => lines.push(l),
      step: async () => {
        throw new ModelClientError("refused", "Cannot connect to LM Studio.", "http://x/v1");
      },
    });
    expect(result.stopReason).toBe("model-unavailable");
    expect(lines.some((l) => /Stopping run — model-unavailable/.test(l))).toBe(true);
  });
});

describe("runLoop — hard iteration cap (5.3)", () => {
  it("a never-stopping script halts at the cap with iteration-cap-exceeded", async () => {
    const lines: string[] = [];
    // Always returns a continue outcome (applied, passing tests, subtask present).
    const result = await runLoop({
      config: config(),
      pendingCount: 2,
      print: (l) => lines.push(l),
      step: scriptedStep([applied("step-1")]),
    });
    expect(result.stopReason).toBe("iteration-cap-exceeded");
    expect(result.state.iterations).toBe(2 + ITERATION_SLACK);
    expect(lines.some((l) => /iteration-cap-exceeded/.test(l))).toBe(true);
  });
});
