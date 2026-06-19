/**
 * `localcoder summarize` (HLD-SRD §3.4, §3.9, §12, §13; CLI.md; 0001_07).
 *
 * Closes the daily loop by folding finished work into durable `/ai` memory.
 *
 * Flow (side-effect ordering: session BEFORE memory, so a later memory-append
 * failure leaves a re-runnable partial):
 *   1. resolveActive() — none → error, non-zero exit.
 *   2. Load config + task + session + memory + optional Git diff.
 *   3. buildContext({ role: 'summarizer', task, session }).
 *   4. ModelClient.complete(summarizer system + rendered user).
 *        §12 ModelClientError → propagates unchanged; NOTHING written.
 *   5. tolerantExtract(content, summarizerSchema).
 *        fail → minimal session-only note + warning, non-zero exit; NO memory
 *        writes.
 *   6. updateSession(sessionUpdate, nextStep)  ← SESSION FIRST.
 *   7. For each memoryUpdate: normalize(changeType) → POLICY target file →
 *        appendMemoryEntry(). Out-of-table changeType → ignored + warning.
 *   8. Return { session, updatedFiles, ignored, json }.
 *
 * Security: the model NEVER picks the target file. The code resolves it from
 * the POLICY table using the declared changeType (§13).
 */
import path from "node:path";
import { detectGitRoot } from "../utils/gitRoot.js";
import { layout } from "../utils/paths.js";
import { readIfExists } from "../utils/fs.js";
import { ConfigManager } from "../core/configManager.js";
import { loadMemoryFiles } from "../core/memoryLoader.js";
import { buildContext } from "../core/contextBuilder.js";
import { resolveActive } from "../core/activePointer.js";
import { parseTask } from "../core/taskManager.js";
import { loadSession, updateSession } from "../core/sessionManager.js";
import { getPrompt } from "../core/promptManager.js";
import { LmStudioClient } from "../core/modelClient.js";
import { POLICY, normalize, headingFor } from "../core/memoryPolicy.js";
import { appendMemoryEntry } from "../core/memoryManager.js";
import { summarizerSchema, type SummarizerOutput } from "../types/summary.js";
import { parseActiveTask, parseActiveSession } from "../types/context.js";
import { repoIndexSchema, type RepoIndex } from "../types/index.js";
import type { ModelClient } from "../types/model.js";
import type { AppConfig } from "../types/config.js";
import type { Session } from "../types/session.js";
import { simpleGit } from "simple-git";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class CommandError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CommandError";
    this.exitCode = exitCode;
  }
}

function defaultClientFactory(config: AppConfig): ModelClient {
  return new LmStudioClient({
    baseUrl: config.model.baseUrl,
    model: config.model.model,
    apiKey: config.model.apiKey,
    temperature: config.model.temperature,
    timeoutMs: config.model.timeoutMs,
  });
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

/** Current working-tree diff: "" when not a git repo or no changes. */
async function currentDiff(root: string): Promise<string> {
  const git = simpleGit(root);
  try {
    if (!(await git.checkIsRepo())) return "";
    return await git.diff(["HEAD"]);
  } catch {
    try {
      return await git.diff();
    } catch {
      return "";
    }
  }
}

/** First balanced `{...}` substring — string/escape aware. */
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
 * Tolerantly extract a SummarizerOutput from raw model output.
 * Returns null when no parseable + valid structure is found.
 */
function tolerantExtractSummary(raw: string): SummarizerOutput | null {
  // 1. Strict whole-output parse.
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
      const r = summarizerSchema.safeParse(obj);
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
    const r = summarizerSchema.safeParse(obj);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SummarizeOptions {
  cwd: string;
  json?: boolean;
  /** Injectable for tests; defaults to the real LM Studio client. */
  clientFactory?: (config: AppConfig) => ModelClient;
}

export interface SummarizeResult {
  session: Session;
  updatedFiles: string[];
  ignored: string[];
  json: boolean;
}

export async function runSummarize(opts: SummarizeOptions): Promise<SummarizeResult> {
  const git = await detectGitRoot(opts.cwd);
  const root = git.root ?? opts.cwd;
  const l = layout(root);

  // 1. Resolve the active session (required).
  const active = await resolveActive(l.orchestratorDir);
  if (active.kind === "none") {
    throw new CommandError(
      'No active session. Create or resume a task first with `localcoder task "…"` or `localcoder resume`.',
    );
  }
  if (active.kind === "missing-target") {
    throw new CommandError(
      `The active pointer references a missing file: ${active.missing.join(", ")}. ` +
        "Create a new task with `localcoder task \"…\"` or pick another with `localcoder resume`.",
    );
  }
  const { taskPath, sessionPath } = active.pointer;

  // 2. Load config, task, session, memory, and the optional Git diff.
  const config = await new ConfigManager(l.configFile).load();
  const task = await parseTask(taskPath);
  const session = await loadSession(sessionPath);
  const index = await loadIndex(l.orchestratorDir);
  const memory = await loadMemoryFiles(root);
  const diff = await currentDiff(root);

  // 3. Build the summarizer context.
  // Include the diff as additional context in the user prompt.
  const pkg = buildContext({
    role: "summarizer",
    config,
    index,
    memory,
    task: parseActiveTask(task.raw),
    session: parseActiveSession(session.raw),
    fileContents: {},
  });

  // Augment the user prompt with the diff (optional).
  const diffSection =
    diff.trim().length > 0
      ? `\n\n## Git Diff\n\n\`\`\`diff\n${diff}\n\`\`\``
      : "\n\n## Git Diff\n\n(No uncommitted changes detected — summarize task/session progress only.)";

  const summarizer = getPrompt("summarizer");
  const userPromptWithDiff = pkg.userPrompt + diffSection;

  // 4. Call the model — §12 ModelClientError propagates; NOTHING written yet.
  const client = (opts.clientFactory ?? defaultClientFactory)(config);
  const response = await client.complete({
    role: "summarizer",
    systemPrompt: summarizer.system,
    userPrompt: summarizer.renderUser(userPromptWithDiff),
  });

  // 5. Tolerantly parse the response.
  const summary = tolerantExtractSummary(response.content);

  if (summary === null) {
    // Minimal session-only update + warning + non-zero exit; NO memory writes.
    const failedSession = await updateSession(session, {
      currentState: "summary attempted; model output unparseable",
    });
    process.stderr.write(
      "warning: summarize: model output could not be parsed into a valid summary. " +
        "Session updated with a minimal note; memory files were NOT written.\n",
    );
    const err = new CommandError(
      "summarize: model output could not be parsed into a valid summary. " +
        "Session updated with a minimal note; no memory files were written.",
    ) as CommandError & { session: Session; updatedFiles: string[]; ignored: string[]; json: boolean };
    // Attach the partial result for callers that catch and inspect.
    (err as unknown as Record<string, unknown>).session = failedSession;
    (err as unknown as Record<string, unknown>).updatedFiles = [];
    (err as unknown as Record<string, unknown>).ignored = [];
    (err as unknown as Record<string, unknown>).json = opts.json ?? false;
    throw err;
  }

  // 6. SESSION FIRST — update the session before any memory writes.
  const updatedSession = await updateSession(session, {
    currentState: summary.sessionUpdate.currentState,
    nextStep: summary.nextStep,
    decisions: summary.sessionUpdate.decisions,
    risks: summary.sessionUpdate.risks,
  });

  // 7. Apply memory updates via the POLICY table.
  const updatedFiles: string[] = [];
  const ignored: string[] = [];

  for (const update of summary.memoryUpdates) {
    const key = normalize(update.changeType);
    if (key === undefined) {
      process.stderr.write(
        `warning: summarize: ignored update for unknown change type '${update.changeType}'\n`,
      );
      ignored.push(update.changeType);
      continue;
    }
    const targetFile = POLICY[key];
    const heading = headingFor(key);
    if (targetFile === undefined || heading === undefined) {
      // Should not happen if POLICY and HEADINGS are in sync — defensive.
      process.stderr.write(
        `warning: summarize: no policy entry for key '${key}' (change type '${update.changeType}')\n`,
      );
      ignored.push(update.changeType);
      continue;
    }
    const fullPath = l.memoryFile(targetFile);
    await appendMemoryEntry(fullPath, heading, update.content);
    if (!updatedFiles.includes(targetFile)) {
      updatedFiles.push(targetFile);
    }
  }

  // 8. Return the result.
  return {
    session: updatedSession,
    updatedFiles,
    ignored,
    json: opts.json ?? false,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatSummarizeResult(result: SummarizeResult): string {
  const parts: string[] = [];
  if (result.updatedFiles.length > 0) {
    parts.push(`Updated: ${result.updatedFiles.join(", ")}`);
  } else {
    parts.push("No memory files updated.");
  }
  parts.push(`Session: ${result.session.status}`);
  if (result.ignored.length > 0) {
    parts.push(`Ignored (unknown change types): ${result.ignored.join(", ")}`);
  }
  return parts.join("; ");
}
