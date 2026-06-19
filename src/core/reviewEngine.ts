/**
 * Review Engine (HLD-SRD §3.12; 0001_06).
 *
 * Powers the advisory `review` command: collect the current Git diff, build a
 * reviewer context, ask the model to review it, and tolerantly parse the JSON
 * report — falling back to the raw text on a parse failure so a local model's
 * imperfect output never blocks the human. The engine NEVER edits, reverts, or
 * applies code; it only reads the diff and returns a report.
 *
 * The tolerant extractor mirrors the 0001_04 planner extractor: strict
 * whole-output parse, else the FIRST balanced `{...}` block, validated against
 * `reviewReportSchema` (whose array fields default `[]`). A total failure
 * returns `null`, and the caller prints the raw review.
 */
import { simpleGit } from "simple-git";
import { buildContext } from "./contextBuilder.js";
import { getPrompt } from "./promptManager.js";
import { loadMemoryFiles } from "./memoryLoader.js";
import { resolveActive } from "./activePointer.js";
import { parseTask } from "./taskManager.js";
import { loadSession } from "./sessionManager.js";
import { ConfigManager } from "./configManager.js";
import { layout } from "../utils/paths.js";
import { readIfExists } from "../utils/fs.js";
import { repoIndexSchema, type RepoIndex } from "../types/index.js";
import { parseActiveTask, parseActiveSession } from "../types/context.js";
import { reviewReportSchema, type ReviewReport } from "../types/review.js";
import type { AppConfig } from "../types/config.js";
import type { ModelClient } from "../types/model.js";
import path from "node:path";

/**
 * Find the first balanced `{...}` substring, tracking string/escape state so
 * braces inside strings do not unbalance the count. Mirrors the 0001_04
 * planner extractor.
 */
function firstBalancedObject(raw: string): string | undefined {
  const start = raw.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return undefined;
}

/**
 * Tolerantly extract + validate a review report from raw model output. Returns
 * the parsed report, or `null` when nothing parseable + valid is found (the
 * caller then prints the raw text).
 */
export function tolerantParseReviewReport(raw: string): ReviewReport | null {
  // 1. Strict whole-output parse.
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
      const r = reviewReportSchema.safeParse(obj);
      if (r.success) return r.data;
    }
  } catch {
    // fall through
  }
  // 2. First balanced {...} block.
  const block = firstBalancedObject(raw);
  if (block === undefined) return null;
  try {
    const obj = JSON.parse(block) as unknown;
    const r = reviewReportSchema.safeParse(obj);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

const EMPTY_INDEX: RepoIndex = {
  generatedAt: "",
  root: "",
  files: [],
} as unknown as RepoIndex;

async function loadIndex(orchestratorDir: string): Promise<RepoIndex> {
  const raw = await readIfExists(path.join(orchestratorDir, "index.json"));
  if (raw === undefined) return EMPTY_INDEX;
  try {
    const parsed = repoIndexSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_INDEX;
  } catch {
    return EMPTY_INDEX;
  }
}

/**
 * The current working-tree diff for the repo at `root`: staged + unstaged
 * changes to tracked files (`git diff HEAD`). Returns "" when nothing changed
 * or the directory is not a git repo.
 */
export async function currentDiff(root: string): Promise<string> {
  const git = simpleGit(root);
  try {
    if (!(await git.checkIsRepo())) return "";
    // `git diff HEAD` captures both staged and unstaged tracked changes.
    return await git.diff(["HEAD"]);
  } catch {
    // No commits yet, or git error — fall back to the plain working-tree diff.
    try {
      return await git.diff();
    } catch {
      return "";
    }
  }
}

/** Parse the changed-file paths from a unified diff (`diff --git a/x b/x`). */
export function changedFilesOf(diff: string): string[] {
  const files = new Set<string>();
  const re = /^diff --git a\/(.+?) b\/(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(diff)) !== null) {
    files.add(m[2]);
  }
  return [...files];
}

export interface BuildReviewPromptInputs {
  config: AppConfig;
  index: RepoIndex;
  memory: Awaited<ReturnType<typeof loadMemoryFiles>>;
  taskRaw?: string;
  sessionRaw?: string;
  diff: string;
}

/**
 * Build the reviewer system + user prompts. The Context Builder assembles the
 * task/session/memory; the diff (which it does not model) is appended to the
 * user prompt so the reviewer sees exactly what changed.
 */
export function buildReviewPrompt(inputs: BuildReviewPromptInputs): {
  systemPrompt: string;
  userPrompt: string;
} {
  const pkg = buildContext({
    role: "reviewer",
    config: inputs.config,
    index: inputs.index,
    memory: inputs.memory,
    ...(inputs.taskRaw !== undefined ? { task: parseActiveTask(inputs.taskRaw) } : {}),
    ...(inputs.sessionRaw !== undefined
      ? { session: parseActiveSession(inputs.sessionRaw) }
      : {}),
    fileContents: {},
  });
  const changed = changedFilesOf(inputs.diff);
  const reviewer = getPrompt("reviewer");
  const userContext =
    pkg.userPrompt +
    `\n\n## Changed files\n\n${changed.length > 0 ? changed.map((f) => `- ${f}`).join("\n") : "(none parsed)"}` +
    `\n\n## Diff under review\n\n\`\`\`diff\n${inputs.diff}\n\`\`\``;
  return {
    systemPrompt: reviewer.system,
    userPrompt: reviewer.renderUser(userContext),
  };
}

export interface ReviewEngineDeps {
  cwd: string;
  client: ModelClient;
}

export interface ReviewEngineResult {
  hadChanges: boolean;
  /** The parsed report (when the model output was parseable). */
  report?: ReviewReport;
  /** The raw model output (always captured when the model was called). */
  raw?: string;
}

/**
 * Run the review: collect the diff, call the model, tolerantly parse the report.
 * Returns `{ hadChanges: false }` when the diff is empty (the caller prints "No
 * changes to review" and exits 0). A model error propagates to the caller.
 */
export async function runReviewEngine(deps: ReviewEngineDeps): Promise<ReviewEngineResult> {
  const { detectGitRoot } = await import("../utils/gitRoot.js");
  const git = await detectGitRoot(deps.cwd);
  const root = git.root ?? deps.cwd;
  const l = layout(root);

  const diff = await currentDiff(root);
  if (diff.trim().length === 0) {
    return { hadChanges: false };
  }

  const config = await new ConfigManager(l.configFile).load();
  const index = await loadIndex(l.orchestratorDir);
  const memory = await loadMemoryFiles(root);

  // Active task/session are optional context — review works without them.
  let taskRaw: string | undefined;
  let sessionRaw: string | undefined;
  const active = await resolveActive(l.orchestratorDir);
  if (active.kind === "ok") {
    try {
      taskRaw = (await parseTask(active.pointer.taskPath)).raw;
    } catch {
      // ignore
    }
    try {
      sessionRaw = (await loadSession(active.pointer.sessionPath)).raw;
    } catch {
      // ignore
    }
  }

  const { systemPrompt, userPrompt } = buildReviewPrompt({
    config,
    index,
    memory,
    ...(taskRaw !== undefined ? { taskRaw } : {}),
    ...(sessionRaw !== undefined ? { sessionRaw } : {}),
    diff,
  });

  // A §12 ModelClientError propagates unchanged — the caller maps it to a
  // non-zero exit with the connectivity guidance.
  const response = await deps.client.complete({
    role: "reviewer",
    systemPrompt,
    userPrompt,
  });

  const report = tolerantParseReviewReport(response.content);
  return {
    hadChanges: true,
    ...(report !== null ? { report } : {}),
    raw: response.content,
  };
}
