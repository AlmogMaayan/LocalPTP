/**
 * `run` loop driver (HLD-SRD §3.13, §11.2; 0001_06).
 *
 * Loops the shared step core over the active task's pending subtasks, printing a
 * per-step progress line, consulting the pure `decideStop` after each step, and
 * enforcing a HARD iteration cap (`pending + slack`) as an infinite-loop guard
 * on top of `decideStop`. The actual step runner is injected so the loop is
 * fully offline-testable with a scripted core.
 *
 * Initial-patch refusals THROW from the step core (preserving the 0001_05 `step`
 * behavior); the loop catches them and maps them to the matching `StopReason`
 * so a single `step` and a looped `run` report stop conditions identically.
 */
import { decideStop } from "./stopConditions.js";
import { ModelClientError } from "../types/model.js";
import {
  CommandError,
} from "./runStep.js";
import {
  PatchValidationError,
  PatchApplyError,
  WorkingTreeUnsafeError,
} from "./patchManager.js";
import type { AppConfig } from "../types/config.js";
import type { LoopState, StepOutcome, StopReason } from "../types/run.js";

/** Extra iterations beyond the pending count before the hard cap trips. */
export const ITERATION_SLACK = 5;

export interface RunLoopDeps {
  /** Run one step; resolves to its outcome or throws on an initial-patch refusal. */
  step: () => Promise<StepOutcome>;
  config: AppConfig;
  /** The number of pending subtasks at loop start (sets the cap). */
  pendingCount: number;
  /** Output sink (defaults to process.stdout.write); injectable for tests. */
  print?: (line: string) => void;
}

export interface RunLoopResult {
  /** The reason the loop stopped. */
  stopReason: StopReason;
  /** The accumulated loop state at stop. */
  state: LoopState;
  /** The number of steps that applied a patch. */
  applied: number;
}

/** Map a thrown initial-patch error to the matching stop reason. */
export function errorToStopReason(err: unknown): StopReason {
  if (err instanceof ModelClientError) return "model-unavailable";
  if (err instanceof WorkingTreeUnsafeError) return "unsafe-tree";
  if (err instanceof PatchValidationError || err instanceof PatchApplyError) {
    return "patch-invalid";
  }
  if (err instanceof CommandError) {
    const m = err.message.toLowerCase();
    if (m.includes("did not return a valid unified diff")) return "unparseable-output";
    if (m.includes("too many changed files")) return "broad-rewrite-requested";
    if (m.includes("mid-merge") || m.includes("working tree")) return "unsafe-tree";
    if (m.includes("refusing to apply")) return "risky-change";
    return "patch-invalid";
  }
  // Unknown error — surface as a generic patch-invalid stop (the loop stops,
  // the message is printed by the caller). Re-throwing would crash the run.
  return "patch-invalid";
}

/** A human-readable progress line for one completed step. */
export function progressLine(state: LoopState, outcome: StepOutcome): string {
  const subtask = outcome.subtaskId ?? "(none)";
  const applied = outcome.applied ? "applied" : "no-op";
  const tests = outcome.testResults.length;
  const failed = outcome.testResults.filter((r) => r.exitCode !== 0).length;
  const testPart =
    tests === 0
      ? "no tests"
      : failed === 0
        ? `${tests} test(s) passing`
        : `${failed}/${tests} test(s) failing`;
  const fixPart = outcome.fixAttempts > 0 ? `, ${outcome.fixAttempts} fix attempt(s)` : "";
  return `Step ${state.iterations + 1}: ${subtask} — ${applied}, ${testPart}${fixPart}`;
}

export async function runLoop(deps: RunLoopDeps): Promise<RunLoopResult> {
  const print = deps.print ?? ((line: string) => process.stdout.write(line));
  const state: LoopState = { iterations: 0, consecutiveFailures: 0, filesChanged: 0 };
  const cap = deps.pendingCount + ITERATION_SLACK;
  let applied = 0;

  while (state.iterations < cap) {
    let outcome: StepOutcome;
    try {
      outcome = await deps.step();
    } catch (err) {
      const reason = errorToStopReason(err);
      const message = err instanceof Error ? err.message : String(err);
      print(`${message}\n`);
      print(`Stopping run — ${reason}\n`);
      return { stopReason: reason, state, applied };
    }

    print(progressLine(state, outcome) + "\n");
    if (outcome.applied) applied += 1;

    const reason = decideStop(outcome, state, deps.config);
    if (reason !== null) {
      if (reason === "acceptance-met") {
        print("Acceptance criteria met — no pending subtasks remain.\n");
        print(
          "Recommend: run `localcoder summarize` (0001_07) to close the session.\n",
        );
      } else {
        print(`Stopping run — ${reason}\n`);
      }
      return { stopReason: reason, state, applied };
    }

    // Continue: advance the loop bookkeeping.
    state.iterations += 1;
    if (outcome.testResults.some((r) => r.exitCode !== 0)) {
      state.consecutiveFailures += 1;
    } else {
      state.consecutiveFailures = 0;
    }
  }

  // Fell through the cap without a decideStop reason — the hard guard.
  print(`Stopping run — iteration-cap-exceeded\n`);
  return { stopReason: "iteration-cap-exceeded", state, applied };
}
