/**
 * `localptp plan` (HLD-SRD §3.9, §11.2, §12; CLI.md).
 *
 * The first command that calls the model for real work. Flow (writes happen
 * ONLY after a valid plan exists, so a model/parse failure saves nothing):
 *   1. Detect root + load config.
 *   2. resolveActive() — none → "create a task" error; missing-target → advise
 *      task/resume; ok → load the active task + session.
 *   3. Load index (tolerant: empty if absent) + memory + file bodies.
 *   4. buildContext({ role: 'planner', task, session }).
 *   5. ModelClient.complete(planner system + rendered user). A §12
 *      ModelClientError propagates unchanged (the CLI prints its message).
 *   6. extractAndValidatePlannerJson(content) — failure → §11.2 stop.
 *   7. setSubtasks into the task (task-first, the source of truth), then update
 *      the session Current State / Next Step / Risks / Decisions(questions).
 *   8. Return the validated plan; `--json` makes the CLI emit only the plan.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { detectGitRoot } from "../utils/gitRoot.js";
import { layout } from "../utils/paths.js";
import { readIfExists } from "../utils/fs.js";
import { ConfigManager } from "../core/configManager.js";
import { loadMemoryFiles } from "../core/memoryLoader.js";
import { buildContext } from "../core/contextBuilder.js";
import { resolveActive } from "../core/activePointer.js";
import { parseTask, setSubtasks, serializeTask } from "../core/taskManager.js";
import { loadSession, updateSession } from "../core/sessionManager.js";
import { getPrompt } from "../core/promptManager.js";
import {
  extractAndValidatePlannerJson,
  UnparseablePlanError,
  type NormalizedPlan,
} from "../core/plannerJson.js";
import { LmStudioClient } from "../core/modelClient.js";
import { parseActiveTask, parseActiveSession } from "../types/context.js";
import { repoIndexSchema, type RepoIndex } from "../types/index.js";
import type { ModelClient } from "../types/model.js";
import type { AppConfig } from "../types/config.js";
import type { Subtask } from "../types/task.js";

export interface PlanOptions {
  cwd: string;
  json?: boolean;
  /** Injectable for tests; defaults to the real LM Studio client. */
  clientFactory?: (config: AppConfig) => ModelClient;
}

export interface PlanResult {
  plan: NormalizedPlan;
  json: boolean;
  taskPath: string;
  sessionPath: string;
}

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

/** Load the repo index if present + valid, else an empty index (planning is tolerant). */
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

async function loadFileContents(
  root: string,
  index: RepoIndex,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of index.files) {
    const rel = f.path.replace(/\\/g, "/");
    try {
      out[rel] = await fs.readFile(path.join(root, rel), "utf8");
    } catch {
      // Omit unreadable/deleted files; planning degrades gracefully.
    }
  }
  return out;
}

export async function runPlan(opts: PlanOptions): Promise<PlanResult> {
  const git = await detectGitRoot(opts.cwd);
  const root = git.root ?? opts.cwd;
  const l = layout(root);

  // 1. Resolve the active task/session.
  const active = await resolveActive(l.orchestratorDir);
  if (active.kind === "none") {
    throw new CommandError(
      'No active task. Create one first with `localptp task "…"`.',
    );
  }
  if (active.kind === "missing-target") {
    throw new CommandError(
      `The active pointer references a missing file: ${active.missing.join(", ")}. ` +
        "Create a new task with `localptp task \"…\"` or pick another with `localptp resume`.",
    );
  }
  const { taskPath, sessionPath } = active.pointer;

  // 2. Load config, task, session.
  const config = await new ConfigManager(l.configFile).load();
  const task = await parseTask(taskPath);
  const session = await loadSession(sessionPath);

  // 3. Build the planner context (tolerant of a missing index).
  const index = await loadIndex(l.orchestratorDir);
  const memory = await loadMemoryFiles(root);
  const fileContents = await loadFileContents(root, index);
  const pkg = buildContext({
    role: "planner",
    config,
    index,
    memory,
    task: parseActiveTask(task.raw),
    session: parseActiveSession(session.raw),
    fileContents,
  });

  // 4. Call the model. A §12 ModelClientError propagates unchanged — no writes
  //    have happened yet, so nothing is saved.
  const client = (opts.clientFactory ?? defaultClientFactory)(config);
  const planner = getPrompt("planner");
  const response = await client.complete({
    role: "planner",
    systemPrompt: planner.system,
    userPrompt: planner.renderUser(pkg.userPrompt),
  });

  // 5. Extract + validate. Failure → §11.2 stop, nothing saved.
  let plan: NormalizedPlan;
  try {
    plan = extractAndValidatePlannerJson(response.content);
  } catch (err) {
    if (err instanceof UnparseablePlanError) {
      throw new CommandError(
        "The model output could not be parsed into a valid plan. Nothing was saved. " +
          "Try `localptp plan` again or narrow the task.",
      );
    }
    throw err;
  }

  // 6. Persist — task first (source of truth for subtasks), then the session.
  const subtasks: Subtask[] = plan.subtasks.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    status: "pending",
    risk: s.risk,
    likelyFiles: s.likelyFiles,
    acceptanceCriteria: s.acceptanceCriteria,
  }));
  const edited = setSubtasks(task, subtasks);
  await fs.writeFile(edited.path, serializeTask(edited), "utf8");

  const first = plan.subtasks[0];
  const decisions = plan.questions.map((q) => `Open question: ${q}`);
  await updateSession(session, {
    currentState: plan.summary,
    nextStep: `${first.id}: ${first.title}`,
    risks: plan.risks,
    decisions,
  });

  return { plan, json: opts.json ?? false, taskPath, sessionPath };
}

export function formatPlanResult(result: PlanResult): string {
  const { plan } = result;
  const lines: string[] = [`Plan (${plan.subtasks.length} subtasks):`];
  for (const s of plan.subtasks) {
    const risk = s.risk === "high" ? "HIGH" : s.risk;
    lines.push(`  ${s.id}  ${s.title}   risk: ${risk}`);
  }
  if (plan.questions.length > 0) {
    lines.push("Questions:");
    for (const q of plan.questions) lines.push(`  - ${q}`);
  }
  return lines.join("\n");
}
