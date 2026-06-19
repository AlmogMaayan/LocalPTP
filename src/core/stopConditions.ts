/**
 * Stop conditions for the `run` loop (HLD-SRD §11.2; 0001_06).
 *
 * `decideStop` is a PURE function over the latest `StepOutcome`, the loop state,
 * and the config. It returns a named `StopReason` to stop, or `null` to
 * continue. Keeping it pure makes every §11.2 condition independently
 * unit-testable with scripted outcomes and keeps the loop driver thin.
 *
 * Decision order (design.md "decideStop"):
 *   1. a stopReason bubbled up from `runStep` (safety refusal, approval denied,
 *      unparseable, patch-invalid, repeated-failure, …) — return it verbatim;
 *   2. no pending subtask AND nothing applied → `acceptance-met` (the MVP
 *      acceptance heuristic: no pending subtasks remain);
 *   3. tests still failing AND the fix-attempt budget is exhausted →
 *      `repeated-failure` (a safety net; `runStep` normally sets this itself,
 *      and it also covers the `maxFailedFixAttempts = 0` boundary);
 *   4. otherwise → `null` (continue).
 *
 * `iteration-cap-exceeded` is produced by the loop driver on cap fall-through,
 * not here; but if a caller ever sets it as a stopReason, branch 1 bubbles it.
 */
import type { AppConfig } from "../types/config.js";
import type { LoopState, StepOutcome, StopReason } from "../types/run.js";

function testsFailing(outcome: StepOutcome): boolean {
  return outcome.testResults.some((r) => r.exitCode !== 0);
}

export function decideStop(
  outcome: StepOutcome,
  _state: LoopState,
  config: AppConfig,
): StopReason | null {
  // 1. A stop reason bubbled up from the step core wins.
  if (outcome.stopReason !== undefined) return outcome.stopReason;

  // 2. No pending subtask and nothing applied → acceptance met.
  if (outcome.subtaskId === null && !outcome.applied) return "acceptance-met";

  // 3. Tests still failing after the fix budget is exhausted → repeated failure.
  if (testsFailing(outcome) && outcome.fixAttempts >= config.safety.maxFailedFixAttempts) {
    return "repeated-failure";
  }

  // 4. Continue.
  return null;
}
