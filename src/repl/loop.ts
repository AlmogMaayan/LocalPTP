/**
 * Interactive REPL core loop (HLD-SRD § interactive-repl).
 *
 * `startRepl(opts)` creates exactly one readline.Interface and drives a
 * read-eval-print loop:
 *   - Banner on start, then "> " prompt.
 *   - Empty / whitespace line  → re-prompt (no task created).
 *   - Line starting with "/"  → unknown-command message → re-prompt.
 *   - Bare text               → runTaskFn({ cwd, text }) → formatTaskResult → re-prompt.
 *   - Thrown runTask error     → print err.message → re-prompt (loop continues).
 *   - Ctrl-C (SIGINT):        non-empty partial line → clear → re-prompt;
 *                              empty line → rl.close() → resolve 0.
 *   - Ctrl-D / EOF (close)    → await any in-flight task → resolve 0.
 *
 * Concurrency / close contract
 * ─────────────────────────────
 * readline can buffer and emit multiple "line" events before the first async
 * handler returns (e.g. a multi-line paste). We serialize with an explicit
 * chained promise queue (NOT rl.pause() alone) so at most one runTaskFn is
 * in flight at a time.
 *
 * On "close", any already-in-flight task is awaited and its result/error
 * written. Lines queued-but-not-yet-started are abandoned — no further
 * runTaskFn calls are initiated after close. No prompt/resume is issued on
 * the now-closed interface.
 */
import readline from "node:readline";
import { runTask, formatTaskResult } from "../commands/task.js";
import type { TaskResult } from "../commands/task.js";
import { dispatch } from "./dispatch.js";

export interface ReplOptions {
  cwd: string;
  /** Defaults to process.stdin. */
  input?: NodeJS.ReadableStream;
  /** Defaults to process.stdout. */
  output?: NodeJS.WritableStream;
  /** Defaults to the real runTask; override in tests. */
  runTaskFn?: (opts: { cwd: string; text: string }) => Promise<TaskResult>;
}

const BANNER =
  "LocalPTP REPL — type text to create a task, /help for commands, Ctrl-D to exit.";

export function startRepl(opts: ReplOptions): Promise<number> {
  const {
    cwd,
    input = process.stdin as NodeJS.ReadableStream,
    output = process.stdout as NodeJS.WritableStream,
    runTaskFn = runTask as (opts: { cwd: string; text: string }) => Promise<TaskResult>,
  } = opts;

  return new Promise<number>((resolve) => {
    const rl = readline.createInterface({ input, output, prompt: "> " });

    let closed = false;
    let resolvedOnce = false;

    function finish() {
      if (!resolvedOnce) {
        resolvedOnce = true;
        resolve(0);
      }
    }

    // ── Serialization queue ─────────────────────────────────────────────────
    // We chain handlers off this promise so lines are processed FIFO with no
    // overlap, even if readline emits several "line" events before the first
    // async handler returns.
    //
    // `inflightPromise` always points to the currently-running (or last-settled)
    // handler chain.  On "close", the "close" handler awaits this same promise
    // so the in-flight task can complete and write its output before we resolve.
    let inflightPromise: Promise<void> = Promise.resolve();

    // ── "line" handler ──────────────────────────────────────────────────────
    rl.on("line", (line: string) => {
      const trimmed = line.trim();

      // Capture the previous tail of the queue and chain off it.
      const prev = inflightPromise;
      inflightPromise = (async () => {
        // Always wait for the previous handler to finish first (serialization).
        await prev;

        // If the interface was closed while we were waiting, abandon this line.
        if (closed) return;

        // Empty / whitespace-only line → re-prompt only.
        if (trimmed === "") {
          rl.prompt();
          return;
        }

        // Slash-prefixed line → delegate to dispatcher.
        if (trimmed.startsWith("/")) {
          const { exit } = await dispatch(line, { cwd, rl, output });
          if (exit) {
            rl.close();
          } else if (!closed) {
            rl.prompt();
          }
          return;
        }

        // Bare text → run the task.
        try {
          const result = await runTaskFn({ cwd, text: trimmed });
          // Always write the result — even if close fired while the task was
          // in flight, the spec requires us to write the output before resolving.
          output.write(formatTaskResult(result) + "\n");
          // Only re-prompt if the interface is still open.
          if (!closed) {
            rl.prompt();
          }
        } catch (err) {
          // Same: always write the error, skip the re-prompt if closed.
          output.write((err as Error).message + "\n");
          if (!closed) {
            rl.prompt();
          }
        }
      })();
    });

    // ── "SIGINT" handler ────────────────────────────────────────────────────
    rl.on("SIGINT", () => {
      if (rl.line && rl.line.length > 0) {
        // Clear the partial line and re-prompt.
        rl.write(null as unknown as string, { ctrl: true, name: "u" });
        rl.prompt();
      } else {
        rl.close();
      }
    });

    // ── "close" handler ─────────────────────────────────────────────────────
    rl.on("close", () => {
      if (closed) return; // guard against double-close
      closed = true;

      // Await the in-flight task (if any) so its output is written before we
      // resolve.  We do NOT call rl.prompt() or rl.resume() after this point.
      inflightPromise.then(finish, finish);
    });

    // Print banner and initial prompt.
    output.write(BANNER + "\n");
    rl.prompt();
  });
}
