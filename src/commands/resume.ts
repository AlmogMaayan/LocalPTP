/**
 * `localcoder resume` (HLD-SRD §3.6; CLI.md).
 *
 * Pure filesystem operation (no model call). Lists sessions newest-first with
 * status + Next-Step preview, selects one (a 1-based index arg, else a stdin
 * number under TTY), loads it, writes the active pointer, and prints the Next
 * Step. No sessions → friendly message, exit zero. An out-of-range index, or a
 * non-TTY run with no index, is an actionable error (non-zero exit) that
 * activates nothing.
 */
import { detectGitRoot } from "../utils/gitRoot.js";
import { layout } from "../utils/paths.js";
import { listSessions } from "../core/sessionManager.js";
import { writeActive } from "../core/activePointer.js";
import type { Session } from "../types/session.js";

export interface ResumeOptions {
  cwd: string;
  /** 1-based index into the newest-first list (CLI arg). */
  index?: number;
  json?: boolean;
  /** Whether stdin is interactive; defaults to process.stdin.isTTY. */
  isTTY?: boolean;
  /** Injectable interactive picker (returns a 1-based index) for TTY runs. */
  prompt?: (sessions: Session[]) => Promise<number | undefined>;
}

export interface ResumeResult {
  sessions: Session[];
  selected?: Session;
}

class CommandError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CommandError";
    this.exitCode = exitCode;
  }
}

export async function runResume(opts: ResumeOptions): Promise<ResumeResult> {
  const git = await detectGitRoot(opts.cwd);
  const root = git.root ?? opts.cwd;
  const l = layout(root);

  const sessions = await listSessions(l.sessionsDir);
  if (sessions.length === 0) {
    // Friendly, exit zero.
    return { sessions };
  }

  // Resolve the selection (1-based).
  let index = opts.index;
  if (index === undefined) {
    const isTTY = opts.isTTY ?? Boolean(process.stdin.isTTY);
    if (isTTY && opts.prompt) {
      index = await opts.prompt(sessions);
    }
    if (index === undefined) {
      throw new CommandError(
        `Specify a session index 1–${sessions.length}, e.g. \`localcoder resume 1\`.`,
      );
    }
  }

  if (!Number.isInteger(index) || index < 1 || index > sessions.length) {
    throw new CommandError(
      `Invalid selection: ${index}. Choose an index 1–${sessions.length}.`,
    );
  }

  const selected = sessions[index - 1];
  await writeActive(l.orchestratorDir, {
    taskPath: selected.taskPath,
    sessionPath: selected.path,
  });

  return { sessions, selected };
}

function shortStamp(sessionPath: string): string {
  const base = sessionPath.replace(/\\/g, "/").split("/").pop() ?? "";
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{4})/.exec(base);
  return m ? `${m[1]}_${m[2]}` : base;
}

function nextPreview(session: Session): string {
  const ns = session.nextStep.split(/\r?\n/)[0]?.trim() ?? "";
  return ns.length > 0 ? ns : "(none)";
}

export function formatResumeResult(result: ResumeResult): string {
  if (result.sessions.length === 0) {
    return 'No sessions yet. Create a task with `localcoder task "…"`.';
  }
  const lines: string[] = [];
  result.sessions.forEach((s, i) => {
    lines.push(
      `  ${i + 1}) ${shortStamp(s.path)}  (${s.status}, next: ${nextPreview(s)})`,
    );
  });
  if (result.selected) {
    lines.push(`Loaded. Next step: ${nextPreview(result.selected)}`);
  }
  return lines.join("\n");
}
