/**
 * Patch + safety types (HLD-SRD §3.10, §11, §13; design.md "Data contracts").
 *
 * `PatchPlan` is the parsed, classified view of a single unified diff: the set
 * of touched repo-relative paths split by operation (add / modify / delete),
 * a binary flag, and the raw diff text retained for `git apply`. The Safety
 * Manager turns a `PatchPlan` + config into a `SafetyVerdict` — a PURE decision
 * (`allow` | `refuse`) plus any extra confirmations the command must prompt for.
 */

/** A parsed, classified unified diff. */
export interface PatchPlan {
  /** Every repo-relative POSIX path the diff touches (adds ∪ modifies ∪ deletes). */
  touchedFiles: string[];
  /** Paths the diff creates (no prior file). */
  adds: string[];
  /** Paths the diff edits in place. */
  modifies: string[];
  /** Paths the diff removes. */
  deletes: string[];
  /** True when any file section is a binary patch (`GIT binary patch`). */
  isBinary: boolean;
  /** The raw unified diff text (what `git apply` consumes). */
  diff: string;
}

export type SafetyDecision = "allow" | "refuse";

/** The extra interactive confirmations a patch requires before applying. */
export type SafetyConfirm = "risky-path" | "delete";

/**
 * The pure outcome of `safetyManager.evaluate`. `refuse` stops the step with
 * the matching §11/§13 reason; `allow` may still carry `needsConfirm` prompts
 * the command turns into explicit confirmations.
 */
export interface SafetyVerdict {
  decision: SafetyDecision;
  needsConfirm: SafetyConfirm[];
  /** Human-readable messages keyed to §11/§13 (one per triggered rule). */
  reasons: string[];
}
