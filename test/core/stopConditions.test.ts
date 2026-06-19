/**
 * Pure `decideStop` — one case per StopReason + the continue case (task 4.1).
 */
import { describe, it, expect } from "vitest";
import { decideStop } from "../../src/core/stopConditions.js";
import { appConfigSchema, type AppConfig } from "../../src/types/config.js";
import type { LoopState, StepOutcome, StopReason } from "../../src/types/run.js";
import type { TestResult } from "../../src/types/test.js";

const STATE: LoopState = { iterations: 0, consecutiveFailures: 0, filesChanged: 0 };

function config(maxFixAttempts = 2): AppConfig {
  return appConfigSchema.parse({ safety: { maxFailedFixAttempts: maxFixAttempts } });
}

function passing(): TestResult[] {
  return [{ command: "t", exitCode: 0, stdout: "", stderr: "", durationMs: 1 }];
}
function failing(): TestResult[] {
  return [{ command: "t", exitCode: 1, stdout: "", stderr: "", durationMs: 1 }];
}

function outcome(over: Partial<StepOutcome> = {}): StepOutcome {
  return {
    subtaskId: "subtaskId" in over ? (over.subtaskId as string | null) : "step-1",
    applied: over.applied ?? true,
    testResults: over.testResults ?? passing(),
    fixAttempts: over.fixAttempts ?? 0,
    ...(over.stopReason !== undefined ? { stopReason: over.stopReason } : {}),
  };
}

describe("decideStop — bubbles a step stopReason (4.1)", () => {
  const bubbled: StopReason[] = [
    "risky-change",
    "unparseable-output",
    "budget-exceeded",
    "unsafe-tree",
    "model-unavailable",
    "approval-denied",
    "patch-invalid",
    "broad-rewrite-requested",
    "iteration-cap-exceeded",
    "repeated-failure",
  ];
  for (const reason of bubbled) {
    it(`bubbles ${reason}`, () => {
      expect(decideStop(outcome({ stopReason: reason }), STATE, config())).toBe(reason);
    });
  }
});

describe("decideStop — acceptance-met (4.1)", () => {
  it("no pending subtask and nothing applied → acceptance-met", () => {
    expect(
      decideStop(outcome({ subtaskId: null, applied: false, testResults: [] }), STATE, config()),
    ).toBe("acceptance-met");
  });
});

describe("decideStop — repeated-failure via budget (4.1)", () => {
  it("tests failing and attempts >= max → repeated-failure", () => {
    expect(
      decideStop(
        outcome({ testResults: failing(), fixAttempts: 2 }),
        STATE,
        config(2),
      ),
    ).toBe("repeated-failure");
  });

  it("maxFailedFixAttempts = 0 boundary: failing with zero attempts → repeated-failure", () => {
    expect(
      decideStop(
        outcome({ testResults: failing(), fixAttempts: 0 }),
        STATE,
        config(0),
      ),
    ).toBe("repeated-failure");
  });
});

describe("decideStop — continue (4.1)", () => {
  it("applied cleanly, tests passing, subtask present → null (continue)", () => {
    expect(decideStop(outcome(), STATE, config())).toBeNull();
  });

  it("tests failing but attempts remain → null (keep fixing)", () => {
    expect(
      decideStop(
        outcome({ testResults: failing(), fixAttempts: 1 }),
        STATE,
        config(2),
      ),
    ).toBeNull();
  });
});
