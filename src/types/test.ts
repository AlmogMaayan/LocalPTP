/**
 * Test Runner result type (HLD-SRD §3.11).
 *
 * The captured outcome of one configured test command. Report-only this slice:
 * the runner never retries and a non-zero `exitCode` never rolls back the patch.
 */
export interface TestResult {
  /** The command line as displayed (e.g. `npm test`). */
  command: string;
  /** Process exit code; 0 = pass. */
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Wall-clock duration of the command, milliseconds. */
  durationMs: number;
}
