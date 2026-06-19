/**
 * Approval seam (design.md assumption 2; CLI.md Safety).
 *
 * `Approver` is an injectable async predicate the `step` command awaits before
 * applying a patch (and for each risky/delete confirmation). The seam keeps the
 * whole flow deterministic and offline-testable: tests inject `autoApprove` /
 * `autoDeny` or a custom stub; production uses `ttyApprove`, a readline yes/no
 * prompt behind the same seam.
 */
import readline from "node:readline";

/** Resolves true to proceed, false to stop. The prompt is the question shown. */
export type Approver = (prompt: string) => Promise<boolean>;

/** Test/CI stub: always proceed. */
export const autoApprove: Approver = async () => true;

/** Test/CI stub: always stop. */
export const autoDeny: Approver = async () => false;

/**
 * Real TTY prompt: ask `prompt` on stdin and resolve true for an affirmative
 * answer (`y`/`yes`, case-insensitive). Any other answer — including EOF or a
 * non-interactive stdin — resolves false (deny-by-default, the safe choice).
 */
export const ttyApprove: Approver = (prompt: string) => {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`${prompt} [y/N] `, (answer) => {
      rl.close();
      resolve(/^\s*y(es)?\s*$/i.test(answer));
    });
  });
};
