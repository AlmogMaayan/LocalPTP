/**
 * Safety Manager — enforcement of HLD-SRD §11/§13 (pure).
 *
 * `evaluate(plan, config, root)` is a PURE function over a parsed `PatchPlan`
 * plus config: no fs, no git, fully unit-testable. It returns a `SafetyVerdict`
 * the `step` command acts on — `refuse` stops with the matching message;
 * `allow` may carry `needsConfirm` prompts (`risky-path`, `delete`).
 *
 * Gate ordering (fail-fast, before any write — design.md "Safety gate ordering"):
 *   1. binary patch                              → refuse
 *   2. any path escaping root                    → refuse (§13)
 *   3. any ignored/generated file                → refuse (§3.10)
 *   4. touched files > maxChangedFilesPerStep     → refuse (§11)
 *   5. any risky-path match (incl `.env*`)        → needsConfirm += 'risky-path' (§13)
 *   6. any delete                                 → needsConfirm += 'delete'      (§13)
 *
 * The git-dependent gates (working-tree-safe, `git apply --check`) live in the
 * command because they need the repo; `evaluate` is deliberately git-free.
 *
 * Path normalization (so the risky/ignore globs match regardless of diff form):
 * strip a leading `a/`/`b/` prefix, convert `\` to `/`, drop `./` and a leading
 * `/`. Globs are matched dotfile-aware so `.env*` hits `.env` and `.env.local`.
 */
import path from "node:path";
import type { AppConfig } from "../types/config.js";
import type { PatchPlan, SafetyConfirm, SafetyVerdict } from "../types/patch.js";

// ---------------------------------------------------------------------------
// Path normalization + glob matching
// ---------------------------------------------------------------------------

/** Repo-relative POSIX form for matching. The plan paths are ALREADY prefix-
 * stripped by `parsePatch`, so this does NOT re-strip an `a/`/`b/` prefix (that
 * would corrupt a real path whose first segment is literally `a`/`b`). Absolute
 * markers are caught by the escape gate, which runs first. */
function normalize(p: string): string {
  let s = p.replace(/\\/g, "/").replace(/^\.\//, "");
  while (s.startsWith("/")) s = s.slice(1);
  return s;
}

/** Lexical root-escape detection (mirrors patchManager's lexical checks). */
function escapesRootLexically(p: string): boolean {
  const raw = p.replace(/\\/g, "/");
  if (path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p) || raw.startsWith("/")) {
    return true;
  }
  const stripped = raw.replace(/^[ab]\//, "").replace(/^\.\//, "");
  const normalized = path.posix.normalize(stripped);
  return normalized === ".." || normalized.startsWith("../");
}

/**
 * Convert a glob to a RegExp, dotfile-aware. Supports `**` (any path span,
 * including across `/`), `*` (any run within a segment, including a leading
 * dot), and `?`. A leading `**` followed by a slash may match zero leading
 * segments so a `auth` glob matches `auth/x` as well as `src/auth/x`.
 */
function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/\\/g, "/");
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        // `**` — match any characters including `/`.
        i += 1;
        if (g[i + 1] === "/") {
          // `**/` — also allow zero leading segments.
          i += 1;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        // `*` — any run within a segment (no `/`).
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Secret/`.env*` patterns that are ALWAYS risky (HLD-SRD §13: no secret
 * auto-modify) regardless of `config.safety.riskyPaths`. A user who customizes
 * `riskyPaths` and drops `.env*` must still get the secret confirmation — the
 * guarantee is enforced here, not left to config.
 */
const ALWAYS_RISKY = [".env*", "**/.env*"];

/** Does any configured (or always-risky) glob match the normalized path? */
function isRiskyPath(rel: string, riskyPaths: string[]): boolean {
  const basename = rel.split("/").pop() ?? rel;
  for (const glob of [...ALWAYS_RISKY, ...riskyPaths]) {
    const re = globToRegExp(glob);
    if (re.test(rel)) return true;
    // A bare-name / basename glob (e.g. `.env*`) should also match the file's
    // basename anywhere in the tree (e.g. `config/.env.local`).
    if (!glob.includes("/") && re.test(basename)) return true;
  }
  return false;
}

/** Ignore semantics shared with the indexer / patchManager. */
function isIgnored(rel: string, config: AppConfig): boolean {
  const parts = rel.split("/");
  const basename = parts[parts.length - 1];
  const baseline = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    "coverage",
    ".ai-orchestrator",
  ]);
  for (const seg of parts) {
    if (baseline.has(seg)) return true;
  }
  for (const pat of config.ignore) {
    if (rel === pat) return true;
    if (rel.startsWith(pat + "/")) return true;
    if (basename === pat) return true;
    if (parts.includes(pat)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// evaluate
// ---------------------------------------------------------------------------

/**
 * Evaluate a parsed plan against the safety config. Pure — `root` is accepted
 * for parity with the wider seam but not dereferenced (no fs/git here).
 */
export function evaluate(
  plan: PatchPlan,
  config: AppConfig,
  _root: string,
): SafetyVerdict {
  const reasons: string[] = [];

  // 1. Binary.
  if (plan.isBinary) {
    return {
      decision: "refuse",
      needsConfirm: [],
      reasons: ["Binary patch not supported (§13)."],
    };
  }

  // 2. Path escape (§13).
  for (const p of plan.touchedFiles) {
    if (escapesRootLexically(p)) {
      return {
        decision: "refuse",
        needsConfirm: [],
        reasons: [`Path escapes the repository root: ${p} (§13).`],
      };
    }
  }

  // 3. Ignored / generated (§3.10).
  for (const p of plan.touchedFiles) {
    const rel = normalize(p);
    if (isIgnored(rel, config)) {
      return {
        decision: "refuse",
        needsConfirm: [],
        reasons: [`Patch touches an ignored/generated file: ${rel} (§3.10).`],
      };
    }
  }

  // 4. Changed-file cap (§11).
  if (plan.touchedFiles.length > config.safety.maxChangedFilesPerStep) {
    return {
      decision: "refuse",
      needsConfirm: [],
      reasons: [
        `Too many changed files: ${plan.touchedFiles.length} > ` +
          `maxChangedFilesPerStep (${config.safety.maxChangedFilesPerStep}) (§11).`,
      ],
    };
  }

  // 5. Risky path (§13) — second confirmation, never auto-approved.
  const needsConfirm: SafetyConfirm[] = [];
  const riskyHit = plan.touchedFiles.some((p) =>
    isRiskyPath(normalize(p), config.safety.riskyPaths),
  );
  if (riskyHit) {
    needsConfirm.push("risky-path");
    reasons.push("Patch touches a configured risky path (§13).");
  }

  // 6. Delete (§13) — explicit deletion confirmation.
  if (plan.deletes.length > 0) {
    needsConfirm.push("delete");
    reasons.push("Patch deletes one or more files (§13).");
  }

  return { decision: "allow", needsConfirm, reasons };
}
