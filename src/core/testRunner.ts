/**
 * Test Runner (HLD-SRD §3.11) — report-only.
 *
 * Runs each configured command via `execa` with an explicit argv ARRAY (never a
 * shell string) so there is no shell-injection surface, captures
 * `{command, exitCode, stdout, stderr, durationMs}`, and prints a `✓`/`✗` line.
 * It NEVER retries and NEVER rolls back an applied patch on failure — the
 * auto-fix loop is 0001_06.
 *
 * A command is given as a `[file, args]` tuple; the caller (the `step` command)
 * splits configured command strings into tuples (config carries strings like
 * `npm test`; the splitter is a thin helper here so commands stay arg-array).
 */
import { execa } from "execa";
import type { TestResult } from "../types/test.js";

/** A command to run: an executable plus its argument vector. */
export type TestCommand = [file: string, args: string[]];

/**
 * Split a configured command string (e.g. `npm run test`) into a `[file, args]`
 * tuple by whitespace. This is intentionally simple (no quote handling) — the
 * MVP config commands are plain `npm …` invocations. An empty/blank string
 * yields undefined so the caller can skip it.
 */
export function splitCommand(command: string): TestCommand | undefined {
  const parts = command.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  return [parts[0], parts.slice(1)];
}

export interface RunTestsOptions {
  /**
   * Working directory to run each command in. Defaults to the process cwd, but
   * the `step` command passes the resolved repository ROOT so tests run against
   * the same tree the patch was applied to (the invocation cwd may be a
   * subdirectory of the repo root).
   */
  cwd?: string;
}

/**
 * Run each command in order, report-only. Resolves to one `TestResult` per
 * command (in order). A non-zero exit is captured, not thrown; a command that
 * cannot even be spawned (ENOENT) is reported with exitCode 127.
 */
export async function runTests(
  commands: TestCommand[],
  opts: RunTestsOptions = {},
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const [file, args] of commands) {
    const display = [file, ...args].join(" ");
    const started = Date.now();
    try {
      const r = await execa(file, args, {
        reject: false,
        all: false,
        stripFinalNewline: false,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      });
      results.push({
        command: display,
        exitCode: r.exitCode ?? 1,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? "",
        durationMs: Date.now() - started,
      });
    } catch (err) {
      // execa with reject:false should not throw on a non-zero exit; this is a
      // spawn failure (e.g. the executable is missing).
      results.push({
        command: display,
        exitCode: 127,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
    }
  }
  return results;
}

/** Format a single result as a `✓`/`✗` report line. */
export function formatTestResult(r: TestResult): string {
  const mark = r.exitCode === 0 ? "✓" : "✗";
  return `${mark} ${r.command} (exit ${r.exitCode}, ${r.durationMs}ms)`;
}
