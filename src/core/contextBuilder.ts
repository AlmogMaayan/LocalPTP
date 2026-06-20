/**
 * Context Builder (HLD-SRD §3.7, §6, §9, §10.1).
 *
 * `buildContext` is a PURE, deterministic function: it performs no I/O and
 * reads only the data handed to it (including a preloaded `fileContents` map).
 * It therefore takes no ModelClient and structurally cannot call the model.
 *
 * Pipeline: heuristic selection (task-driven, else preview) → per-file hard cap
 * → assembly → the §3.7 seven-step over-budget reduction ladder.
 */
import path from "node:path";
import { estimateTokens } from "../utils/tokenEstimate.js";
import { KNOWN_BINARY_EXT } from "./repoIndexer.js";
import { CODER_SYSTEM_PROMPT } from "./prompts.js";
import {
  firstIncompleteSubtask,
  type ActiveTask,
  type ActiveSession,
  type ContextPackage,
} from "../types/context.js";
import type { AgentRole } from "../types/model.js";
import type { AppConfig } from "../types/config.js";
import type { RepoFile, RepoIndex } from "../types/index.js";
import type { MemoryFiles } from "./memoryLoader.js";

export interface ContextInputs {
  role: AgentRole;
  config: AppConfig;
  index: RepoIndex;
  memory: MemoryFiles;
  task?: ActiveTask;
  session?: ActiveSession;
  /** repo-relative POSIX path → body, preloaded by the caller. */
  fileContents: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Memory selection order (HLD-SRD §3.7)
// ---------------------------------------------------------------------------

/**
 * Conditional memory in priority order. `coding-rules.md` is intentionally
 * absent — it is the always-include, ladder-protected project-rules file.
 */
const CONDITIONAL_MEMORY_ORDER = [
  "project-brief.md",
  "file-index.md",
  "data-model.md",
  "api-map.md",
  "external-integrations.md",
  "decisions.md",
  "test-plan.md",
];

const ALWAYS_MEMORY = ["coding-rules.md"];

const TRUNCATION_MARKER = "\n… [truncated]\n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function stripExt(p: string): string {
  const ext = path.posix.extname(p);
  return ext ? p.slice(0, -ext.length) : p;
}

function isBinaryEntry(f: RepoFile): boolean {
  if (f.language === "binary") return true;
  return KNOWN_BINARY_EXT.has(f.extension.toLowerCase());
}

/**
 * Resolve a relative import specifier (`./x`, `../y`) against indexed paths by
 * suffix match. Returns the matched indexed path, or undefined. Bare package
 * specifiers and node builtins are ignored (return undefined).
 */
function resolveImport(
  specifier: string,
  fromPath: string,
  byPath: Map<string, RepoFile>,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined; // package / builtin
  // Normalize the specifier relative to the importing file's directory.
  const fromDir = path.posix.dirname(toPosix(fromPath));
  const resolved = stripExt(toPosix(path.posix.normalize(`${fromDir}/${specifier}`)));
  // Exact (extensionless) match first, then index-suffix match.
  for (const indexed of byPath.keys()) {
    if (stripExt(indexed) === resolved) return indexed;
  }
  const tail = stripExt(toPosix(specifier).replace(/^\.\//, "").replace(/^\.\.\//, ""));
  for (const indexed of byPath.keys()) {
    const ix = stripExt(indexed);
    if (ix === tail || ix.endsWith(`/${tail}`)) return indexed;
  }
  return undefined;
}

/**
 * The import-neighbor source files of a set of seed files: every indexed file
 * a seed's `imports[]` resolves to (by suffix match), excluding the seeds
 * themselves. Deterministic: sorted by size asc then path asc.
 */
export function importNeighbors(
  seedFiles: string[],
  index: RepoIndex,
): string[] {
  const byPath = new Map<string, RepoFile>();
  for (const f of index.files) byPath.set(toPosix(f.path), f);
  const seeds = new Set(seedFiles.map(toPosix));
  const found = new Map<string, RepoFile>();
  for (const seed of seeds) {
    const entry = byPath.get(seed);
    if (!entry) continue;
    for (const spec of entry.imports) {
      const resolved = resolveImport(spec, seed, byPath);
      if (resolved && !seeds.has(resolved)) {
        const f = byPath.get(resolved);
        if (f && !isBinaryEntry(f)) found.set(resolved, f);
      }
    }
  }
  return [...found.values()].sort(compareBySizeThenPath).map((f) => f.path);
}

function compareBySizeThenPath(a: RepoFile, b: RepoFile): number {
  if (a.size !== b.size) return a.size - b.size;
  return a.path.localeCompare(b.path);
}

/**
 * A no-model summary: an index header (path/language/exports/size) followed by
 * the file's first 20 non-blank lines.
 */
export function summarizeFile(entry: RepoFile, body: string): string {
  const exportsStr =
    entry.exports.length > 0 ? entry.exports.join(", ") : "(none)";
  const header = `// ${entry.path} · ${entry.language} · ${entry.size} bytes · exports: ${exportsStr}`;
  const head = body
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 20)
    .join("\n");
  return `${header}\n${head}`;
}

/**
 * A snippet: the first `floor(maxChars / 2)` characters plus a truncation
 * marker. Bodies already at-or-under the snippet size are returned unchanged.
 */
export function snippetFile(body: string, maxChars: number): string {
  const limit = Math.floor(maxChars / 2);
  if (body.length <= limit) return body;
  return body.slice(0, limit) + TRUNCATION_MARKER;
}

/** Hard-cap a body to `maxChars` (selection-time cap, assumption 5a). */
function hardCap(body: string, maxChars: number): string {
  if (body.length <= maxChars) return body;
  return body.slice(0, maxChars) + TRUNCATION_MARKER;
}

// ---------------------------------------------------------------------------
// Direct-test matching
// ---------------------------------------------------------------------------

/** The basename stem of a test path, stripping `.test`/`.spec` and `test_`. */
function sourceStemsForTest(testPath: string): string[] {
  const base = path.posix.basename(toPosix(testPath));
  const noExt = stripExt(base); // e.g. Foo.test, test_foo, foo_test
  const stems = new Set<string>();
  // Foo.test / Foo.spec → Foo
  const dotted = noExt.replace(/\.(test|spec)$/i, "");
  stems.add(dotted);
  // test_foo → foo  /  foo_test → foo
  stems.add(noExt.replace(/^test_/i, "").replace(/_test$/i, ""));
  return [...stems];
}

/** Is `test` a direct test of `source`? (import resolves OR basename-stem). */
function isDirectTestOf(
  test: RepoFile,
  source: RepoFile,
  byPath: Map<string, RepoFile>,
): boolean {
  // (a) import resolution
  for (const spec of test.imports) {
    if (resolveImport(spec, test.path, byPath) === toPosix(source.path)) {
      return true;
    }
  }
  // (b) basename-stem match
  const sourceStem = stripExt(path.posix.basename(toPosix(source.path)));
  return sourceStemsForTest(test.path).includes(sourceStem);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

interface Selection {
  editFiles: string[]; // protected source files (the current subtask's likelyFiles)
  sourceFiles: string[]; // editFiles + neighbors (task) OR preview sample
  testFiles: string[]; // direct tests of selected source
  warnings: string[];
}

export function selectFiles(inputs: ContextInputs): Selection {
  const { config, index, task } = inputs;
  const ctx = config.context;
  const warnings: string[] = [];

  const byPath = new Map<string, RepoFile>();
  for (const f of index.files) byPath.set(toPosix(f.path), f);

  // Edit files: the current subtask's likelyFiles (capped).
  let editFiles: string[] = [];
  if (task) {
    const subtask = firstIncompleteSubtask(task) ?? task.subtasks?.[0];
    const likely = subtask?.likelyFiles ?? [];
    // Keep only files that exist in the index and are not binary.
    editFiles = likely
      .map(toPosix)
      .filter((p) => {
        const f = byPath.get(p);
        return f !== undefined && !isBinaryEntry(f);
      })
      .slice(0, ctx.maxEditFilesPerStep);
  }

  // Source files.
  let sourceFiles: string[];
  let testFiles: string[] = [];

  if (task) {
    const neighbors = ctx.includeImportNeighbors
      ? importNeighbors(editFiles, index)
      : [];
    // Combined non-edit selection (neighbors + tests) is bounded by
    // maxFilesPerStep. Edit files are reserved first and never dropped.
    const combined: string[] = [...editFiles];
    const seen = new Set(editFiles);
    const room = () => combined.length < ctx.maxFilesPerStep;

    for (const n of neighbors) {
      if (!room()) break;
      if (seen.has(n)) continue;
      combined.push(n);
      seen.add(n);
    }
    sourceFiles = combined.slice();

    // Direct tests of any selected source file, filling remaining room.
    if (ctx.includeTests) {
      const selectedSources = sourceFiles
        .map((p) => byPath.get(p))
        .filter((f): f is RepoFile => f !== undefined);
      const testCandidates = index.files
        .filter((f) => f.isTest && !isBinaryEntry(f))
        .filter((t) => !seen.has(toPosix(t.path)))
        .filter((t) =>
          selectedSources.some((s) => isDirectTestOf(t, s, byPath)),
        )
        .sort(compareBySizeThenPath);
      for (const t of testCandidates) {
        if (!room()) break;
        const p = toPosix(t.path);
        if (seen.has(p)) continue;
        testFiles.push(p);
        seen.add(p);
        combined.push(p);
      }
    }
  } else {
    // Preview: smallest-first sample of non-test, non-config, non-binary source.
    const sample = index.files
      .filter((f) => !f.isTest && !f.isConfig && !isBinaryEntry(f))
      .sort(compareBySizeThenPath)
      .slice(0, ctx.maxFilesPerStep)
      .map((f) => toPosix(f.path));
    sourceFiles = sample;
    warnings.push(
      "No active task — showing a budget-capped preview. Run `localptp task \"…\"` to scope context.",
    );
    if (index.files.length === 0) {
      warnings.push("No source files indexed.");
    }
  }

  return { editFiles, sourceFiles, testFiles, warnings };
}

// ---------------------------------------------------------------------------
// Memory selection
// ---------------------------------------------------------------------------

function selectMemory(memory: MemoryFiles): {
  always: string[];
  conditional: string[];
} {
  const always = ALWAYS_MEMORY.filter((name) => memory[name] !== undefined);
  const conditional = CONDITIONAL_MEMORY_ORDER.filter(
    (name) => memory[name] !== undefined,
  );
  return { always, conditional };
}

// ---------------------------------------------------------------------------
// buildContext
// ---------------------------------------------------------------------------

const NARROW_TASK_WARNING =
  "Context package exceeds configured budget. Try narrowing the task or allow summaries/snippets.";

export function buildContext(inputs: ContextInputs): ContextPackage {
  const { role, config, index, memory, task, session, fileContents } = inputs;
  const ctx = config.context;

  const byPath = new Map<string, RepoFile>();
  for (const f of index.files) byPath.set(toPosix(f.path), f);

  const sel = selectFiles(inputs);
  const warnings = [...sel.warnings];

  // System prompt: §10.1 body, role-labeled header.
  const systemPrompt = `[role: ${role}]\n${CODER_SYSTEM_PROMPT}`;

  // Memory selection.
  const mem = selectMemory(memory);
  // Conditional memory may be dropped by ladder step 6 (reverse priority).
  let conditionalMemory = [...mem.conditional];

  // Resolve bodies for selected source/test files, hard-capped per assumption 5a.
  // A path absent from fileContents (e.g. deleted since index) is dropped.
  const bodyFor = (p: string): string | undefined => {
    const raw = fileContents[toPosix(p)];
    if (raw === undefined) return undefined;
    return hardCap(raw, ctx.maxFileChars);
  };

  const presentSource = sel.sourceFiles.filter((p) => bodyFor(p) !== undefined);
  const presentTests = sel.testFiles.filter((p) => bodyFor(p) !== undefined);
  // Edit files are the protected subset of source actually present.
  const editPresent = new Set(
    sel.editFiles.filter((p) => presentSource.includes(toPosix(p))).map(toPosix),
  );

  // Ladder state: which secondary source files are summarized / snippeted.
  const summarized = new Set<string>();
  const snippeted = new Set<string>();

  // --- assembly -----------------------------------------------------------

  const buildUserPrompt = (): string => {
    const parts: string[] = [];

    // Always-include task + session summaries (protected).
    if (task) {
      const goal = task.goal ?? "(no goal stated)";
      const subtask = firstIncompleteSubtask(task) ?? task.subtasks?.[0];
      parts.push(`## Task\n\nGoal: ${goal}`);
      if (subtask) parts.push(`Current subtask: ${subtask.text}`);
    }
    if (session) {
      const lines: string[] = [];
      if (session.currentState) lines.push(`Current state: ${session.currentState}`);
      if (session.nextStep) lines.push(`Next step: ${session.nextStep}`);
      if (lines.length > 0) parts.push(`## Session\n\n${lines.join("\n")}`);
    }

    // Memory: always-include first (protected), then surviving conditional.
    const memNames = [...mem.always, ...conditionalMemory];
    for (const name of memNames) {
      parts.push(`## Memory: ${name}\n\n${memory[name]}`);
    }

    // Source files.
    for (const p of presentSource) {
      const entry = byPath.get(toPosix(p));
      const raw = bodyFor(p);
      if (raw === undefined || !entry) continue;
      let body = raw;
      if (summarized.has(toPosix(p))) {
        body = summarizeFile(entry, fileContents[toPosix(p)] ?? raw);
      } else if (snippeted.has(toPosix(p))) {
        body = snippetFile(raw, ctx.maxFileChars);
      }
      parts.push(`## Source: ${p}\n\n${body}`);
    }

    // Test files.
    for (const p of presentTests) {
      const raw = bodyFor(p);
      if (raw === undefined) continue;
      let body = raw;
      if (snippeted.has(toPosix(p))) body = snippetFile(raw, ctx.maxFileChars);
      parts.push(`## Test: ${p}\n\n${body}`);
    }

    return parts.join("\n\n");
  };

  const totalChars = (): number =>
    systemPrompt.length + buildUserPrompt().length;

  // --- budget ladder ------------------------------------------------------

  const editSet = editPresent; // protected (steps 1–2)
  const directTestSet = new Set(presentTests.map(toPosix)); // protected (step 3)

  /** Secondary (non-edit, non-direct-test) source files, in selection order. */
  const secondarySource = (): string[] =>
    presentSource.filter(
      (p) => !editSet.has(toPosix(p)) && !directTestSet.has(toPosix(p)),
    );

  if (totalChars() > ctx.maxContextChars) {
    // Step 4 — summarize secondary source files.
    let didSummarize = false;
    for (const p of secondarySource()) {
      if (totalChars() <= ctx.maxContextChars) break;
      if (!summarized.has(toPosix(p))) {
        summarized.add(toPosix(p));
        didSummarize = true;
      }
    }
    if (didSummarize) {
      warnings.push(
        "Budget: replaced secondary source files with index summaries.",
      );
    }

    // Step 5 — snippet remaining over-budget files (eligible = non-edit,
    // non-direct-test; summarized files are already small, skip).
    if (totalChars() > ctx.maxContextChars) {
      let didSnippet = false;
      for (const p of secondarySource()) {
        if (totalChars() <= ctx.maxContextChars) break;
        const key = toPosix(p);
        if (summarized.has(key)) continue;
        if (!snippeted.has(key)) {
          snippeted.add(key);
          didSnippet = true;
        }
      }
      if (didSnippet) {
        warnings.push("Budget: snippeted remaining over-budget files.");
      }
    }

    // Step 6 — drop low-relevance memory (reverse conditional priority).
    if (totalChars() > ctx.maxContextChars && conditionalMemory.length > 0) {
      const dropped: string[] = [];
      // Reverse priority: drop the lowest-priority conditional memory first.
      while (
        totalChars() > ctx.maxContextChars &&
        conditionalMemory.length > 0
      ) {
        const drop = conditionalMemory[conditionalMemory.length - 1];
        conditionalMemory = conditionalMemory.slice(0, -1);
        dropped.push(drop);
      }
      if (dropped.length > 0) {
        warnings.push(
          `Budget: dropped low-relevance memory (${dropped.join(", ")}).`,
        );
      }
    }

    // Step 7 — still over budget: warn to narrow the task. Package still returned.
    if (totalChars() > ctx.maxContextChars) {
      warnings.push(NARROW_TASK_WARNING);
    }
  }

  // --- finalize -----------------------------------------------------------

  const userPrompt = buildUserPrompt();
  const includedMemoryFiles = [...mem.always, ...conditionalMemory];
  const estimatedTokens = estimateTokens(systemPrompt + userPrompt);

  return {
    role,
    systemPrompt,
    userPrompt,
    includedMemoryFiles,
    includedSourceFiles: presentSource.map(toPosix),
    includedTestFiles: presentTests.map(toPosix),
    estimatedTokens,
    warnings,
  };
}
