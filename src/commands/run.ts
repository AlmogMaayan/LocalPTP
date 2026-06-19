/**
 * `localcoder run` (HLD-SRD §3.13, §11.2; 0001_06).
 *
 * Automates the daily loop: it drives the shared `runStep` core over the active
 * task's pending subtasks via the `runLoop` driver, pausing for approval at each
 * diff (the core owns approval), printing a per-step progress line, and stopping
 * on the first §11.2 stop condition with a clear reason. The step runner is the
 * SAME core `step` uses, so one-shot and looped execution behave identically.
 *
 * `run` never re-implements the patch pipeline and never runs `summarize`; on
 * acceptance it only RECOMMENDS summarizing (0001_07 owns the command).
 */
import { detectGitRoot } from "../utils/gitRoot.js";
import { layout } from "../utils/paths.js";
import { ConfigManager } from "../core/configManager.js";
import { resolveActive } from "../core/activePointer.js";
import { parseTask } from "../core/taskManager.js";
import { runStep, CommandError } from "../core/runStep.js";
import { runLoop } from "../core/runLoop.js";
import { ttyApprove, type Approver } from "../core/approval.js";
import type { AppConfig } from "../types/config.js";
import type { ModelClient } from "../types/model.js";
import type { StopReason } from "../types/run.js";

export interface RunOptions {
  cwd: string;
  json?: boolean;
  /** Injectable for tests; defaults to the real LM Studio client. */
  clientFactory?: (config: AppConfig) => ModelClient;
  /** Injectable approval seam; defaults to a TTY yes/no prompt. */
  approve?: Approver;
  /** Injectable clock for deterministic patch artifact names. */
  now?: Date;
}

export interface RunResult {
  stopReason: StopReason;
  /** Number of steps that applied a patch. */
  applied: number;
  /** Number of iterations the loop completed (continued past). */
  iterations: number;
  json: boolean;
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const approve = opts.approve ?? ttyApprove;
  const git = await detectGitRoot(opts.cwd);
  const root = git.root ?? opts.cwd;
  const l = layout(root);

  // Resolve the active task to count pending subtasks (sets the iteration cap).
  const active = await resolveActive(l.orchestratorDir);
  if (active.kind === "none") {
    throw new CommandError(
      'No active task. Create one first with `localcoder task "…"`.',
    );
  }
  if (active.kind === "missing-target") {
    throw new CommandError(
      `The active pointer references a missing file: ${active.missing.join(", ")}. ` +
        'Create a new task with `localcoder task "…"` or pick another with `localcoder resume`.',
    );
  }

  const config = await new ConfigManager(l.configFile).load();
  const task = await parseTask(active.pointer.taskPath);
  const pendingCount = task.subtasks.filter((s) => s.status === "pending").length;

  const result = await runLoop({
    config,
    pendingCount,
    step: () =>
      runStep({
        cwd: opts.cwd,
        ...(opts.clientFactory !== undefined ? { clientFactory: opts.clientFactory } : {}),
        approve,
        ...(opts.now !== undefined ? { now: opts.now } : {}),
      }),
  });

  return {
    stopReason: result.stopReason,
    applied: result.applied,
    iterations: result.state.iterations,
    json: opts.json ?? false,
  };
}

export function formatRunResult(result: RunResult): string {
  const lines = [
    `Run stopped: ${result.stopReason}.`,
    `Applied ${result.applied} patch(es) over ${result.iterations} step(s).`,
  ];
  if (result.stopReason === "acceptance-met") {
    lines.push("Recommend: `localcoder summarize` (0001_07) to close the session.");
  }
  return lines.join("\n");
}
