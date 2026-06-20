/**
 * `localptp task "<text>"` (HLD-SRD §3.5, §3.6; CLI.md).
 *
 * Pure filesystem operation (no model call): create the §3.5 task file + §3.6
 * session file, write the active pointer, and report the created paths +
 * active status. Workflow:
 *   1. Detect repo root.
 *   2. createTask(tasksDir, text) → §3.5 file (collision-suffixed, no clobber).
 *   3. createSession(sessionsDir, task) → §3.6 file referencing the task.
 *   4. writeActive(orchestratorDir, { taskPath, sessionPath }).
 *   5. Return the created paths.
 */
import { detectGitRoot } from "../utils/gitRoot.js";
import { layout } from "../utils/paths.js";
import { createTask } from "../core/taskManager.js";
import { createSession } from "../core/sessionManager.js";
import { writeActive } from "../core/activePointer.js";

export interface TaskOptions {
  cwd: string;
  text: string;
  json?: boolean;
}

export interface TaskResult {
  taskPath: string;
  sessionPath: string;
  title: string;
  status: string;
}

class CommandError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CommandError";
    this.exitCode = exitCode;
  }
}

export async function runTask(opts: TaskOptions): Promise<TaskResult> {
  const text = opts.text.trim();
  if (text.length === 0) {
    throw new CommandError(
      'Provide a task description, e.g. localptp task "Add severity levels to alerts".',
    );
  }

  const git = await detectGitRoot(opts.cwd);
  const l = layout(git.root ?? opts.cwd);

  const task = await createTask(l.tasksDir, text);
  const session = await createSession(l.sessionsDir, task);
  await writeActive(l.orchestratorDir, {
    taskPath: task.path,
    sessionPath: session.path,
  });

  return {
    taskPath: task.path,
    sessionPath: session.path,
    title: task.title,
    status: task.status,
  };
}

export function formatTaskResult(result: TaskResult): string {
  return [
    `Created task    ${result.taskPath}`,
    `Created session ${result.sessionPath}`,
    `Status: ${result.status}`,
  ].join("\n");
}
