/**
 * Run-loop types (HLD-SRD §3.13, §11.2; 0001_06).
 *
 * `StopReason` is the closed set of named reasons the run loop can stop for —
 * one per §11.2 condition plus the hard iteration-cap guard. `StepOutcome` is
 * the structured result of one `runStep` invocation that the pure `decideStop`
 * function reasons over; `LoopState` is the loop's accumulated bookkeeping.
 */
import type { TestResult } from "./test.js";

/**
 * The closed set of reasons the `run` loop stops. Each maps to an HLD-SRD §11.2
 * condition; `iteration-cap-exceeded` is the loop's own hard infinite-loop guard.
 */
export type StopReason =
  | "risky-change"
  | "repeated-failure"
  | "acceptance-met"
  | "unparseable-output"
  | "needs-context"
  | "budget-exceeded"
  | "unsafe-tree"
  | "model-unavailable"
  | "approval-denied"
  | "patch-invalid"
  | "broad-rewrite-requested"
  | "iteration-cap-exceeded";

/**
 * The structured result of one `runStep` invocation. `subtaskId` is null when
 * there was no pending subtask (task complete). `applied` is true once a patch
 * (coder or fix) reached the working tree. `stopReason` is set when the step
 * itself hit a stop condition (safety refusal, approval denied, unparseable,
 * etc.) that `decideStop` bubbles up. `fixAttempts` counts test-fix iterations.
 */
export interface StepOutcome {
  subtaskId: string | null;
  applied: boolean;
  stopReason?: StopReason;
  testResults: TestResult[];
  fixAttempts: number;
}

/** Accumulated run-loop bookkeeping across iterations. */
export interface LoopState {
  iterations: number;
  consecutiveFailures: number;
  filesChanged: number;
}
