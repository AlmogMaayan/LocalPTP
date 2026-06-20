/**
 * `localptp step` (HLD-SRD §3.10, §3.11, §3.13, §10.2, §11, §12.3, §13).
 *
 * A thin wrapper over the shared `runStep` core (`src/core/runStep.ts`): it runs
 * ONE pending subtask end-to-end through the core state machine, then adapts the
 * core's `StepCoreResult` to the command-facing `StepResult` for the CLI. The
 * highest-stakes code (the patch apply pipeline + the bounded test-fix loop)
 * lives in the core so `step` (one-shot) and `run` (looped) share identical
 * behavior.
 */
import {
  runStep as runStepCore,
  parseNeedsContext,
  CommandError,
  type StepDeps,
  type NeedsContext,
} from "../core/runStep.js";
import { formatTestResult } from "../core/testRunner.js";
import type { Approver } from "../core/approval.js";
import type { AppConfig } from "../types/config.js";
import type { ModelClient } from "../types/model.js";
import type { TestResult } from "../types/test.js";

export { CommandError, parseNeedsContext };
export type { NeedsContext };

export interface StepOptions {
  cwd: string;
  json?: boolean;
  /** Injectable for tests; defaults to the real LM Studio client. */
  clientFactory?: (config: AppConfig) => ModelClient;
  /** Injectable approval seam; defaults to a TTY yes/no prompt. */
  approve?: Approver;
  /** Injectable clock for deterministic patch artifact names. */
  now?: Date;
}

export interface StepResult {
  /** True once the patch was applied to the working tree. */
  applied: boolean;
  /** True when there was no pending subtask (task done). */
  done: boolean;
  /** Set when the model returned a `needs_context` request instead of a diff. */
  needsContext?: NeedsContext;
  /** The subtask this step ran (when one was pending). */
  subtaskId?: string;
  /** The saved patch artifact path (when applied). */
  patchPath?: string;
  /** Captured test results (empty when no tests configured or nothing applied). */
  testResults: TestResult[];
  json: boolean;
}

export async function runStep(opts: StepOptions): Promise<StepResult> {
  const deps: StepDeps = {
    cwd: opts.cwd,
    ...(opts.clientFactory !== undefined ? { clientFactory: opts.clientFactory } : {}),
    ...(opts.approve !== undefined ? { approve: opts.approve } : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  };
  const outcome = await runStepCore(deps);
  return {
    applied: outcome.applied,
    done: outcome.done,
    ...(outcome.needsContext !== undefined ? { needsContext: outcome.needsContext } : {}),
    ...(outcome.subtaskId !== null ? { subtaskId: outcome.subtaskId } : {}),
    ...(outcome.patchPath !== undefined ? { patchPath: outcome.patchPath } : {}),
    testResults: outcome.testResults,
    json: opts.json ?? false,
  };
}

export function formatStepResult(result: StepResult): string {
  if (result.done) {
    return "No pending subtasks — the task is complete.";
  }
  if (result.needsContext) {
    return `Model needs more context: ${result.needsContext.reason}`;
  }
  if (!result.applied) {
    return "Nothing applied.";
  }
  const lines = [`Applied ${result.subtaskId}.`];
  if (result.patchPath) lines.push(`Patch saved: ${result.patchPath}`);
  for (const r of result.testResults) {
    lines.push(formatTestResult(r));
  }
  return lines.join("\n");
}
