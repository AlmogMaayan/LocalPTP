/**
 * REPL-aware Approver (HLD-SRD § interactive-repl).
 *
 * Reuses the loop's already-open `readline.Interface` instead of creating a
 * second competing reader on the same stdin — so approval prompts inside the
 * REPL never contend with the loop's interface.
 */
import type readline from "node:readline";
import type { Approver } from "../core/approval.js";

/**
 * Returns an `Approver` that asks `prompt [y/N]` via the given
 * `readline.Interface` and resolves `true` for `y`/`yes` (any case, any
 * surrounding whitespace), `false` for everything else (deny-by-default).
 */
export function replApprover(rl: readline.Interface): Approver {
  return (prompt: string) =>
    new Promise<boolean>((resolve) => {
      // If the interface closes while the question is outstanding, settle the
      // approval as declined (false) so the in-flight dispatch can complete and
      // the loop can resolve normally (no hang on 'close').
      function onClose() {
        resolve(false);
      }
      rl.once("close", onClose);
      rl.question(`${prompt} [y/N] `, (answer) => {
        rl.removeListener("close", onClose);
        resolve(/^\s*y(es)?\s*$/i.test(answer));
      });
    });
}
