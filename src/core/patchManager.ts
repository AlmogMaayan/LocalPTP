/**
 * Patch Manager (HLD-SRD §3.10).
 *
 * Turns raw model output into an applied, audited patch — safely and never
 * partially. The pipeline the `step` command drives:
 *   extractUnifiedDiff(raw) → parsePatch(diff) → validate(plan,config,root)
 *   → apply(plan,root) [git apply --check then git apply; new-file fallback]
 *   → savePatch(diff,stepId,orchestratorDir).
 *
 * Invariants enforced here:
 *   - extraction is tolerant of fences/prose but yields null for empty output
 *     and for a `needs_context` JSON response (so the command never tries to
 *     apply a non-diff);
 *   - validation refuses an `add` over an existing file (never overwrite), a
 *     missing modify/delete target, an ignored/generated file, and any path
 *     that escapes the repo root — including escape *through* a symlinked
 *     directory (realpath/lstat, not just `path.resolve`);
 *   - `apply` pre-flights with `git apply --check`; a failing check never
 *     mutates the tree. In a non-git dir only an add-only patch applies (via a
 *     controlled write); any existing-file edit there is refused (no rollback
 *     layer).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { simpleGit } from "simple-git";
import { ensureDir } from "../utils/fs.js";
import type { AppConfig } from "../types/config.js";
import type { PatchPlan } from "../types/patch.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A path/target/ignore validation failure (§3.10, §13). Carries an exit code. */
export class PatchValidationError extends Error {
  readonly exitCode = 1;
  constructor(message: string) {
    super(message);
    this.name = "PatchValidationError";
  }
}

/** A patch that does not cleanly apply, or an apply mechanism failure (§12.3). */
export class PatchApplyError extends Error {
  readonly exitCode = 1;
  constructor(message: string) {
    super(message);
    this.name = "PatchApplyError";
  }
}

/** The working tree is not safe to apply onto (e.g. mid-merge/rebase) (§11.2). */
export class WorkingTreeUnsafeError extends Error {
  readonly exitCode = 1;
  constructor(message: string) {
    super(message);
    this.name = "WorkingTreeUnsafeError";
  }
}

// ---------------------------------------------------------------------------
// extractUnifiedDiff
// ---------------------------------------------------------------------------

/** A line that begins a unified diff. */
function isDiffStartLine(line: string): boolean {
  return /^diff --git /.test(line) || /^--- /.test(line);
}

/**
 * Tolerantly extract a unified diff from raw model output. Strips code fences
 * and surrounding prose, returning the diff block (from its first `diff --git`
 * or `---` line through its last diff-shaped line). Returns null when there is
 * no diff — empty/whitespace output, a `needs_context` JSON response, or plain
 * prose.
 */
export function extractUnifiedDiff(raw: string): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // A `needs_context` JSON response is explicitly not a diff. Detect it tolerant
  // of fences/prose by scanning for the status token in the raw text — the
  // command handles the structured parse; here we only need to NOT treat it as
  // a diff.
  if (/"status"\s*:\s*"needs_context"/.test(trimmed)) return null;

  // Drop a single fenced block's fences if the diff lives inside one. We scan
  // line-by-line instead of regex-extracting so prose outside the fence is
  // discarded and the fence markers never leak into the diff body.
  const lines = raw.split(/\r?\n/);

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isDiffStartLine(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  // Collect from the first diff line to the last line that still looks like part
  // of a unified diff. Diff body lines start with one of: `diff `, `index `,
  // `--- `, `+++ `, `@@ `, `+`, `-`, ` ` (context), `\` (no-newline marker),
  // `new file`, `deleted file`, `old mode`, `new mode`, `similarity`, `rename`,
  // `copy`, `GIT binary patch`, or base85 binary literal lines. We stop at the
  // first line after `start` that is clearly prose or a closing fence and is not
  // a diff body line — but only after we have seen at least one hunk/header, so
  // a blank line inside a diff does not prematurely end it.
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) break; // closing fence ends the diff block
    out.push(line);
  }

  // Trim trailing blank lines and any trailing prose that slipped in after the
  // diff (a line that is not a plausible diff body line, scanning from the end).
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last.trim().length === 0) {
      out.pop();
      continue;
    }
    if (isDiffBodyLine(last)) break;
    out.pop();
  }

  if (out.length === 0) return null;
  return out.join("\n") + "\n";
}

/** Whether a line is plausibly part of a unified-diff body (for trailing trim). */
function isDiffBodyLine(line: string): boolean {
  return (
    /^diff /.test(line) ||
    /^index /.test(line) ||
    /^--- /.test(line) ||
    /^\+\+\+ /.test(line) ||
    /^@@ /.test(line) ||
    /^[+\- ]/.test(line) ||
    /^\\ No newline/.test(line) ||
    /^(new|deleted) file mode /.test(line) ||
    /^(old|new) mode /.test(line) ||
    /^(similarity|dissimilarity) index /.test(line) ||
    /^(rename|copy) (from|to) /.test(line) ||
    /^GIT binary patch/.test(line) ||
    /^Binary files .* differ$/.test(line) ||
    /^(literal|delta) \d+/.test(line) ||
    /^[0-9A-Za-z]{1,}$/.test(line) // base85 binary literal line
  );
}

// ---------------------------------------------------------------------------
// parsePatch
// ---------------------------------------------------------------------------

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Decode git's C-style quoted path form (`"a/x y"`, `"a/\303\251.txt"`). Git
 * quotes a header path when it contains a space or a special byte; leaving the
 * quotes/escapes in place would make the safety checks inspect a different path
 * than `git apply` actually writes. Returns the input unchanged when it is not
 * quoted.
 */
function unquoteGitPath(p: string): string {
  const t = p.trim();
  if (!(t.startsWith('"') && t.endsWith('"') && t.length >= 2)) return t;
  const body = t.slice(1, -1);
  // Accumulate raw bytes so a run of octal escapes (git emits one escape per
  // UTF-8 byte, e.g. `\303\251` for `é`) decodes as the original multi-byte
  // character, not per-byte mojibake. Plain ASCII chars are pushed as their
  // single byte; non-ASCII source chars (already decoded) are encoded to UTF-8.
  const bytes: number[] = [];
  const pushChar = (ch: string): void => {
    for (const b of Buffer.from(ch, "utf8")) bytes.push(b);
  };
  const simple: Record<string, string> = {
    n: "\n",
    t: "\t",
    r: "\r",
    '"': '"',
    "\\": "\\",
  };
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      pushChar(body[i]);
      continue;
    }
    const next = body[i + 1];
    // Octal escape (\NNN) — git emits one per raw byte.
    if (next !== undefined && next >= "0" && next <= "7") {
      const m = /^[0-7]{1,3}/.exec(body.slice(i + 1));
      if (m) {
        bytes.push(parseInt(m[0], 8) & 0xff);
        i += m[0].length;
        continue;
      }
    }
    if (next !== undefined && next in simple) {
      pushChar(simple[next]);
      i += 1;
      continue;
    }
    if (next !== undefined) pushChar(next);
    i += 1;
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Strip a leading `a/` or `b/` diff prefix; map `/dev/null` to undefined. */
function stripPrefix(p: string): string | undefined {
  const posix = toPosix(unquoteGitPath(p));
  if (posix === "/dev/null") return undefined;
  return posix.replace(/^[ab]\//, "");
}

/**
 * Parse the two paths from a `diff --git <a> <b>` header tail. Handles both the
 * unquoted form (`a/x b/x`) and git's quoted form for paths with spaces/special
 * bytes (`"a/x y" "b/x y"`). Returns prefix-stripped, unquoted `[a, b]`. A naive
 * whitespace split is wrong for spaced paths — and getting the path wrong here
 * (for a metadata-only empty-file section that has no `---`/`+++` lines) would
 * leave the file out of the plan entirely, skipping every plan-level safety
 * gate while `git apply` still writes it.
 */
function parseGitHeaderPaths(tail: string): [string?, string?] {
  const t = tail.trim();
  // Quoted first path: `"a/..." "b/..."` (either or both sides may be quoted).
  const m =
    /^("(?:\\.|[^"\\])*"|\S+)\s+("(?:\\.|[^"\\])*"|.+)$/.exec(t);
  if (!m) return [undefined, undefined];
  return [stripPrefix(m[1]), stripPrefix(m[2])];
}

/**
 * Parse a unified diff into a classified `PatchPlan`. Each `diff --git` (or, for
 * a header-less diff, each `---`/`+++` pair) is one file section. Classification:
 *   - `new file mode` / `--- /dev/null`  → add
 *   - `deleted file mode` / `+++ /dev/null` → delete
 *   - otherwise → modify
 * `GIT binary patch` in any section sets `isBinary`.
 */
export function parsePatch(diff: string): PatchPlan {
  const lines = diff.split(/\r?\n/);
  const adds: string[] = [];
  const modifies: string[] = [];
  const deletes: string[] = [];
  let isBinary = false;

  interface Section {
    gitA?: string;
    gitB?: string;
    minus?: string; // path on `--- ` line (prefix-stripped), or "/dev/null"
    plus?: string; // path on `+++ ` line
    isNew: boolean;
    isDeleted: boolean;
    minusDevNull: boolean;
    plusDevNull: boolean;
    binary: boolean;
    sawMinus: boolean; // a `--- ` line has been consumed for this section
    sawHunk: boolean; // a `@@` hunk has started — later `--- `/`+++ ` are content
    fromGit: boolean; // section was opened by a `diff --git` header
  }

  const sections: Section[] = [];
  let cur: Section | undefined;

  const startSection = (fromGit: boolean, a?: string, b?: string): void => {
    cur = {
      gitA: a,
      gitB: b,
      isNew: false,
      isDeleted: false,
      minusDevNull: false,
      plusDevNull: false,
      binary: false,
      sawMinus: false,
      sawHunk: false,
      fromGit,
    };
    sections.push(cur);
  };

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // Binary markers set the global flag regardless of whether a section is
    // open: a binary diff with a quoted/spaced `diff --git` path (which the
    // header regex below cannot match) must still be flagged binary so the
    // safety gate refuses it rather than letting `git apply` apply it.
    if (/^GIT binary patch/.test(line) || /^Binary files .* differ$/.test(line)) {
      isBinary = true;
      if (cur) cur.binary = true;
      continue;
    }
    if (/^diff --git /.test(line)) {
      const [a, b] = parseGitHeaderPaths(line.slice("diff --git ".length));
      startSection(true, a, b);
      continue;
    }
    // A `--- ` / `+++ ` line is only a FILE HEADER before the section's first
    // hunk. Once inside a hunk, an added/removed content line such as `+++ x`
    // (the `+` marker plus literal `++ x` content) must NOT be mistaken for a
    // header — that would let hunk content overwrite the section's real path and
    // bypass the ignore/risky-path checks. EXCEPTIONS that DO start a new
    // header-less section even mid-hunk:
    //   - a `--- /dev/null` (unambiguous: a deletion content line is `-…`, never
    //     that sentinel), and
    //   - a `--- <path>` immediately followed by a `+++ <path>` line AND THEN a
    //     `@@ ` hunk line: that triple is the header of the NEXT file in a
    //     header-less multi-file diff. Matching only `--- `+`+++ ` is NOT enough
    //     — hunk CONTENT can look like that pair (a removed line whose text is
    //     `-- x` renders as `--- x`, and an added `++ y` renders as `+++ y`), so
    //     we also require a bare `@@ ` hunk header on the third line. A bare
    //     `@@ ` at column 0 only ever occurs as a real hunk header (inside a hunk
    //     it would be prefixed by `+`/`-`/space), so the triple disambiguates a
    //     true next-file header from look-alike content. Without this, a
    //     header-less diff's 2nd+ files were swallowed as hunk content and
    //     bypassed every plan-level safety gate while `git apply` still wrote
    //     them.
    const minusP = /^--- /.test(line) ? line.slice(4) : undefined;
    const minusIsDevNull =
      minusP !== undefined && toPosix(minusP.trim()) === "/dev/null";
    const nextIsHeaderTriple =
      minusP !== undefined &&
      /^\+\+\+ /.test(lines[li + 1] ?? "") &&
      /^@@ /.test(lines[li + 2] ?? "");
    if (
      minusP !== undefined &&
      (minusIsDevNull || nextIsHeaderTriple || !(cur && cur.sawHunk))
    ) {
      // Attach to the current section unless none exists, its `--- ` line was
      // already consumed, or we are mid-hunk on a new `--- /dev/null` (each of
      // those begins a new header-less section).
      if (!cur || cur.sawMinus || cur.sawHunk) {
        startSection(false);
      }
      cur!.sawMinus = true;
      if (minusIsDevNull) {
        cur!.minusDevNull = true;
      } else {
        cur!.minus = stripPrefix(minusP);
      }
      continue;
    }
    if (!cur) continue;
    if (/^\+\+\+ /.test(line) && !cur.sawHunk) {
      const p = line.slice(4);
      if (toPosix(p.trim()) === "/dev/null") {
        cur.plusDevNull = true;
      } else {
        cur.plus = stripPrefix(p);
      }
      continue;
    }
    if (/^@@ /.test(line)) {
      cur.sawHunk = true;
      continue;
    }
    if (/^new file mode /.test(line)) {
      cur.isNew = true;
      continue;
    }
    if (/^deleted file mode /.test(line)) {
      cur.isDeleted = true;
      continue;
    }
  }

  for (const s of sections) {
    if (s.binary) isBinary = true;
    // Resolve the canonical repo-relative path for this section.
    const path_ =
      s.isDeleted || s.plusDevNull
        ? s.minus ?? s.gitA ?? s.gitB
        : s.plus ?? s.gitB ?? s.gitA ?? s.minus;
    if (path_ === undefined) continue;
    if (s.isNew || s.minusDevNull) {
      adds.push(path_);
    } else if (s.isDeleted || s.plusDevNull) {
      deletes.push(path_);
    } else {
      modifies.push(path_);
    }
  }

  const touchedFiles = [...new Set([...adds, ...modifies, ...deletes])];
  return { touchedFiles, adds, modifies, deletes, isBinary, diff };
}

// ---------------------------------------------------------------------------
// Path / ignore helpers (shared by validate and the Safety Manager)
// ---------------------------------------------------------------------------

/**
 * Normalize an ALREADY-prefix-stripped touched path (the paths in a `PatchPlan`
 * have had their `a/`/`b/` diff prefix removed by `parsePatch`) to repo-relative
 * POSIX form: convert Windows `\` separators and drop a `./` prefix. It does NOT
 * re-strip an `a/`/`b/` prefix — doing so would corrupt a legitimate path whose
 * first segment is literally `a` or `b` (e.g. `a/secure.txt`), causing the
 * ignore / risky-path checks to inspect the wrong path. Absolute markers are
 * preserved for the escape check.
 */
export function normalizeTouchedPath(p: string): string {
  return toPosix(p).replace(/^\.\//, "");
}

/** Is `rel` matched by the config ignore list (same semantics as the indexer)? */
function isIgnored(rel: string, config: AppConfig): boolean {
  const parts = rel.split("/");
  const basename = parts[parts.length - 1];
  // Baseline well-known generated/dependency trees at any depth.
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
    // A directory name anywhere in the path (e.g. `dist` matching `pkg/dist/x`).
    if (parts.includes(pat)) return true;
  }
  return false;
}

/**
 * Whether `rel` (a touched path string from the diff) escapes `root`.
 *
 * Refuses outright: an absolute path, or a path whose lexical normalization
 * leaves the root (a leading `..`). Then, to catch escape *through* a symlinked
 * directory, it realpaths the deepest existing ancestor of the target and
 * verifies the resolved location is still inside the realpath'd root.
 */
async function escapesRoot(rel: string, root: string): Promise<boolean> {
  const raw = toPosix(rel);
  // Absolute paths (POSIX `/x`, Windows `C:/x`) are refused outright.
  if (path.isAbsolute(rel) || /^[A-Za-z]:[\\/]/.test(rel) || raw.startsWith("/")) {
    return true;
  }
  // Lexical escape: normalize and check for a leading `..`.
  const normalized = path.posix.normalize(raw);
  if (normalized === ".." || normalized.startsWith("../")) return true;

  // Symlink escape: realpath the deepest existing ancestor.
  const rootReal = await fs.realpath(root);
  const target = path.resolve(root, normalized);
  let probe = target;
  // Walk up to the first existing ancestor.
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      // `real` is the resolved existing ancestor. The remaining (non-existent)
      // suffix cannot itself be a symlink, so containment of `real` decides.
      const relToRoot = path.relative(rootReal, real);
      if (relToRoot === "") return false;
      // Use `== ".." || startsWith("../")` (not a bare `startsWith("..")`) so a
      // legitimate in-root name that merely begins with `..` (e.g. `..cache`) is
      // not mistaken for a parent-directory escape.
      const posixRel = toPosix(relToRoot);
      if (
        posixRel === ".." ||
        posixRel.startsWith("../") ||
        path.isAbsolute(relToRoot)
      ) {
        return true;
      }
      return false;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        const parent = path.dirname(probe);
        if (parent === probe) return true; // reached fs root without resolving
        probe = parent;
        continue;
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a parsed plan against the repo root + config. Throws
 * `PatchValidationError` on the first violation:
 *   - any touched path escaping the root (absolute, `../`, or symlink escape);
 *   - any touched path matching the ignore list;
 *   - a modify/delete whose target does not exist;
 *   - an add whose target already exists (never overwrite).
 * Resolves (undefined) when the plan is structurally safe to apply.
 */
export async function validate(
  plan: PatchPlan,
  config: AppConfig,
  root: string,
): Promise<void> {
  for (const raw of plan.touchedFiles) {
    const rel = normalizeTouchedPath(raw);
    if (await escapesRoot(raw, root)) {
      throw new PatchValidationError(
        `Refusing patch: path escapes the repository root: ${raw}`,
      );
    }
    if (isIgnored(rel, config)) {
      throw new PatchValidationError(
        `Refusing patch: touches an ignored/generated file: ${rel}`,
      );
    }
  }

  for (const raw of plan.modifies) {
    const rel = normalizeTouchedPath(raw);
    if (!(await pathExists(path.join(root, rel)))) {
      throw new PatchValidationError(
        `Refusing patch: modify target does not exist: ${rel}`,
      );
    }
  }
  for (const raw of plan.deletes) {
    const rel = normalizeTouchedPath(raw);
    if (!(await pathExists(path.join(root, rel)))) {
      throw new PatchValidationError(
        `Refusing patch: delete target does not exist: ${rel}`,
      );
    }
  }
  for (const raw of plan.adds) {
    const rel = normalizeTouchedPath(raw);
    if (await pathExists(path.join(root, rel))) {
      throw new PatchValidationError(
        `Refusing patch: add target already exists (never overwrite): ${rel}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Git detection + working-tree safety
// ---------------------------------------------------------------------------

/** Is `root` the working tree of a git repo? */
async function isGitRepo(root: string): Promise<boolean> {
  try {
    return await simpleGit(root).checkIsRepo();
  } catch {
    return false;
  }
}

/**
 * Refuse to apply onto an unsafe working tree (§11.2). Unsafe = a repo in the
 * middle of a merge / rebase / cherry-pick / revert / bisect (detected by the
 * marker files / dirs git writes). Unrelated dirty files are tolerated — the
 * `git apply --check` pre-flight gates the exact apply. A non-git dir has no
 * merge state, so this is a no-op there.
 */
export async function assertWorkingTreeSafe(root: string): Promise<void> {
  if (!(await isGitRepo(root))) return;
  const gitDir = await resolveGitDir(root);
  const markers = [
    "MERGE_HEAD",
    "rebase-merge",
    "rebase-apply",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
  ];
  for (const m of markers) {
    if (await pathExists(path.join(gitDir, m))) {
      throw new WorkingTreeUnsafeError(
        `Refusing to apply: the repository is mid-operation (${m}). ` +
          "Finish or abort it first (§11.2).",
      );
    }
  }
}

/** Resolve the repo's git dir (handles worktrees where `.git` is a file). */
async function resolveGitDir(root: string): Promise<string> {
  try {
    const out = (
      await simpleGit(root).revparse(["--git-dir"])
    ).trim();
    return path.isAbsolute(out) ? out : path.join(root, out);
  } catch {
    return path.join(root, ".git");
  }
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

/** True when every touched file is a brand-new add (no modify/delete). */
function isAddOnly(plan: PatchPlan): boolean {
  return (
    plan.adds.length > 0 &&
    plan.modifies.length === 0 &&
    plan.deletes.length === 0
  );
}

/**
 * Pre-flight a diff with `git apply --check` (no mutation). Throws
 * `PatchApplyError` when the patch would not apply cleanly. Git repos only —
 * the command skips this for the non-git add-only path.
 */
export async function gitApplyCheck(plan: PatchPlan, root: string): Promise<void> {
  try {
    await execa("git", ["apply", "--check", "--whitespace=nowarn", "-"], {
      cwd: root,
      input: plan.diff,
    });
  } catch (err) {
    throw new PatchApplyError(
      "The patch does not apply cleanly (`git apply --check` failed). " +
        "Nothing was applied (§12.3). " +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

/**
 * Apply a parsed plan to the working tree, never partially.
 *
 * Git repo: `git apply --check` then `git apply` (atomic per call). A failing
 * check leaves the tree untouched.
 *
 * Non-git dir: only an add-only patch is applied, via a controlled write of the
 * new files (the Git pre-check is skipped). Any existing-file modify/delete in a
 * non-git dir is refused with `PatchApplyError` — there is no rollback layer.
 */
export async function apply(plan: PatchPlan, root: string): Promise<void> {
  const git = await isGitRepo(root);
  if (git) {
    await gitApplyCheck(plan, root);
    try {
      await execa("git", ["apply", "--whitespace=nowarn", "-"], {
        cwd: root,
        input: plan.diff,
      });
    } catch (err) {
      throw new PatchApplyError(
        "`git apply` failed after a passing --check. Nothing was applied. " +
          (err instanceof Error ? err.message : String(err)),
      );
    }
    return;
  }

  // Non-git: add-only via controlled write; anything else is refused.
  if (!isAddOnly(plan)) {
    throw new PatchApplyError(
      "Refusing to modify or delete files in a non-git directory: there is no " +
        "Git rollback layer. Initialize a repo (`git init`) first.",
    );
  }
  await controlledWriteAdds(plan, root);
}

/**
 * Write the new files of an add-only plan by reconstructing each file's content
 * from its `+` hunk lines. Used only for the non-git add-only fallback. Refuses
 * to clobber an existing file (defense in depth; `validate` already checked).
 *
 * The non-git path has no Git rollback layer, so this enforces the "never apply
 * a partial patch" invariant itself: it first refuses if ANY target already
 * exists (before writing anything), then, if a later write fails mid-batch, it
 * removes the files it already created so a multi-file add never leaves a partial
 * result behind.
 */
async function controlledWriteAdds(plan: PatchPlan, root: string): Promise<void> {
  const files = reconstructAdds(plan.diff);
  // Pre-flight: refuse the whole batch up front if any target already exists, so
  // a collision on a later file never leaves an earlier file written.
  for (const [rel] of files) {
    if (await pathExists(path.join(root, rel))) {
      throw new PatchApplyError(
        `Refusing to overwrite an existing file via the non-git fallback: ${rel}`,
      );
    }
  }

  const written: string[] = [];
  try {
    for (const [rel, content] of files) {
      // Re-check containment IMMEDIATELY before the write (not just in `validate`,
      // which ran before the approval prompt): a symlinked ancestor could have
      // been swapped in during the await window, redirecting the write outside
      // root. `escapesRoot` realpaths the deepest existing ancestor, so a parent
      // now pointing outside root is caught here. (§13 path-escape invariant.)
      if (await escapesRoot(rel, root)) {
        throw new PatchApplyError(
          `Refusing to write outside the repository root (containment changed since validation): ${rel}`,
        );
      }
      const full = path.join(root, rel);
      await ensureDir(path.dirname(full));
      // `flag: "wx"` keeps each write a never-overwrite create (defense in depth
      // against a TOCTOU create between the pre-flight check and this write).
      await fs.writeFile(full, content, { encoding: "utf8", flag: "wx" });
      written.push(full);
    }
  } catch (err) {
    // Roll back the files this batch already created so the add is all-or-nothing.
    for (const full of written.reverse()) {
      try {
        await fs.rm(full, { force: true });
      } catch {
        // Best-effort cleanup; surface the original failure below regardless.
      }
    }
    if (err instanceof PatchApplyError) throw err;
    throw new PatchApplyError(
      "Failed to write the new files of a non-git add-only patch; rolled back " +
        "the files already created. " +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

/**
 * Reconstruct the content of each added file from its `+` hunk lines. Returns a
 * map of repo-relative POSIX path → file content. Only handles new-file
 * sections (`--- /dev/null` or `new file mode`).
 */
function reconstructAdds(diff: string): Map<string, string> {
  const lines = diff.split(/\r?\n/);
  const out = new Map<string, string>();
  let curPath: string | undefined; // from `+++` (most precise)
  let headerPath: string | undefined; // from `diff --git` gitB (fallback)
  let inHunk = false;
  let buf: string[] = [];
  let isNewFile = false;
  let sawMinus = false; // a `--- ` header has been consumed for the current file
  let trailingNewline = true; // false when a `\ No newline at end of file` follows

  const flush = (): void => {
    const target = curPath ?? headerPath;
    // Emit an entry for every new-file section, even one with no hunk/`+++`
    // (a metadata-only empty-file add): otherwise the controlled write would
    // silently skip a file the plan promised to create.
    if (target !== undefined && isNewFile) {
      const body = buf.join("\n");
      out.set(target, body + (buf.length > 0 && trailingNewline ? "\n" : ""));
    }
    buf = [];
    inHunk = false;
    isNewFile = false;
    sawMinus = false;
    curPath = undefined;
    headerPath = undefined;
    trailingNewline = true;
  };

  for (const line of lines) {
    if (/^diff --git /.test(line)) {
      flush();
      // Capture the `b/` path as a fallback when there is no `+++` line
      // (handles quoted/spaced paths via the shared header parser).
      const [, b] = parseGitHeaderPaths(line.slice("diff --git ".length));
      headerPath = b;
      continue;
    }
    if (/^new file mode /.test(line)) {
      isNewFile = true;
      continue;
    }
    // A `--- /dev/null` line unambiguously starts a NEW added-file section (a
    // hunk content line is `-…`, never the literal `--- /dev/null` sentinel), so
    // flush the previous file even mid-hunk — otherwise a multi-file headerless
    // add concatenates every file's content into the last path. A non-dev/null
    // `--- ` is only treated as a header before the first hunk (mid-hunk it is
    // content, mirroring the Q1 guard in parsePatch).
    const isMinus = /^--- /.test(line);
    const isMinusDevNull = isMinus && toPosix(line.slice(4).trim()) === "/dev/null";
    if (isMinusDevNull || (isMinus && !inHunk)) {
      if (sawMinus || curPath !== undefined || inHunk) flush();
      sawMinus = true;
      if (isMinusDevNull) isNewFile = true;
      continue;
    }
    if (/^\+\+\+ /.test(line) && !inHunk) {
      // Header `+++ ` line only before the hunk; once in a hunk a `+++ x` line
      // is added CONTENT (`+` marker + `++ x`), captured by the `+` branch below.
      const p = stripPrefix(line.slice(4));
      if (p !== undefined) curPath = p;
      continue;
    }
    if (/^@@ /.test(line)) {
      inHunk = true;
      continue;
    }
    if (/^\\ No newline at end of file/.test(line)) {
      trailingNewline = false;
      continue;
    }
    if (inHunk && line.startsWith("+")) {
      buf.push(line.slice(1));
      continue;
    }
    // Ignore context/`-` lines (an add has only `+` content).
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// savePatch
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export interface SavePatchOptions {
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

/**
 * Save the raw diff as a patch artifact under
 * `<orchestratorDir>/patches/YYYY-MM-DD_HHMM_<step-id>.patch`. Returns the
 * absolute path written. Never overwrites: a name collision appends `-2`, `-3`…
 */
export async function savePatch(
  diff: string,
  stepId: string,
  orchestratorDir: string,
  opts: SavePatchOptions = {},
): Promise<string> {
  const now = opts.now ?? new Date();
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const safeId = stepId.replace(/[^A-Za-z0-9._-]/g, "_");
  const patchesDir = path.join(orchestratorDir, "patches");
  await ensureDir(patchesDir);

  const base = `${stamp}_${safeId}`;
  let attempt = 0;
  for (;;) {
    const name = attempt === 0 ? `${base}.patch` : `${base}-${attempt + 1}.patch`;
    const full = path.join(patchesDir, name);
    try {
      await fs.writeFile(full, diff, { encoding: "utf8", flag: "wx" });
      return full;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
}
