/**
 * `localcoder context` (HLD-SRD §3.7, §9, §15 Test 5; CLI.md).
 *
 * Read-only preview of the context package the Context Builder would assemble
 * for a role. Makes NO model call. Workflow:
 *   1. Detect repo root + load config.
 *   2. Load .ai-orchestrator/index.json (actionable error if missing).
 *   3. Load /ai memory.
 *   4. Find + tolerantly parse the newest /ai/tasks/* and /ai/sessions/* (optional).
 *   5. Read indexed file bodies into a fileContents map; a file that fails to
 *      read (e.g. deleted since index) is omitted and a warning is collected.
 *   6. buildContext(...) → ContextPackage.
 *   7. Print the CLI.md summary, or the structured package with --json.
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
import {
  parseActiveTask,
  parseActiveSession,
  type ActiveTask,
  type ActiveSession,
  type ContextPackage,
} from "../types/context.js";
import { repoIndexSchema, type RepoIndex } from "../types/index.js";
import type { AgentRole } from "../types/model.js";

const VALID_ROLES: AgentRole[] = [
  "planner",
  "retriever",
  "coder",
  "reviewer",
  "test-fixer",
  "summarizer",
];

export interface ContextOptions {
  cwd: string;
  role?: string;
  json?: boolean;
}

export interface ContextResult {
  pkg: ContextPackage;
  maxContextTokens: number;
}

class CommandError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CommandError";
    this.exitCode = exitCode;
  }
}

function resolveRole(role: string | undefined): AgentRole {
  if (role === undefined) return "coder";
  if ((VALID_ROLES as string[]).includes(role)) return role as AgentRole;
  throw new CommandError(
    `Unknown role: ${role}. Valid roles: ${VALID_ROLES.join(", ")}.`,
  );
}

/** Return the newest (by mtime) `*.md` file body under `dir`, or undefined. */
async function newestMarkdown(dir: string): Promise<string | undefined> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  let newest: { body: string; mtimeMs: number; name: string } | undefined;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const full = path.join(dir, entry.name);
    try {
      const stat = await fs.stat(full);
      const body = await fs.readFile(full, "utf8");
      const mtimeMs = stat.mtimeMs;
      if (
        newest === undefined ||
        mtimeMs > newest.mtimeMs ||
        // Deterministic tiebreak when mtimes are equal: latest name wins.
        (mtimeMs === newest.mtimeMs && entry.name > newest.name)
      ) {
        newest = { body, mtimeMs, name: entry.name };
      }
    } catch {
      // Skip unreadable entries.
    }
  }
  return newest?.body;
}

export async function runContext(opts: ContextOptions): Promise<ContextResult> {
  const { cwd } = opts;
  const role = resolveRole(opts.role);

  // 1. Root + config.
  const git = await detectGitRoot(cwd);
  const root = git.root ?? cwd;
  const l = layout(root);
  const config = await new ConfigManager(l.configFile).load();

  // 2. Load index.
  const indexPath = path.join(l.orchestratorDir, "index.json");
  const rawIndex = await readIfExists(indexPath);
  if (rawIndex === undefined) {
    throw new CommandError(
      "No repository index found. Run `localcoder index` first.",
    );
  }
  let index: RepoIndex;
  try {
    const parsed = repoIndexSchema.safeParse(JSON.parse(rawIndex));
    if (!parsed.success) {
      throw new CommandError(
        "The repository index is malformed. Re-run `localcoder index`.",
      );
    }
    index = parsed.data;
  } catch (err) {
    if (err instanceof CommandError) throw err;
    throw new CommandError(
      "The repository index could not be read as JSON. Re-run `localcoder index`.",
    );
  }

  // 3. Memory.
  const memory = await loadMemoryFiles(root);

  // 4. Optional active task / session. Prefer the explicit active pointer
  //    (0001_04); fall back to the newest-file heuristic when the pointer is
  //    absent or dangles.
  let task: ActiveTask | undefined;
  let session: ActiveSession | undefined;
  const active = await resolveActive(l.orchestratorDir);
  if (active.kind === "ok") {
    const taskMd = await readIfExists(active.pointer.taskPath);
    if (taskMd !== undefined) task = parseActiveTask(taskMd);
    const sessionMd = await readIfExists(active.pointer.sessionPath);
    if (sessionMd !== undefined) session = parseActiveSession(sessionMd);
  }
  if (task === undefined) {
    const taskMd = await newestMarkdown(l.tasksDir);
    if (taskMd !== undefined) task = parseActiveTask(taskMd);
  }
  if (session === undefined) {
    const sessionMd = await newestMarkdown(l.sessionsDir);
    if (sessionMd !== undefined) session = parseActiveSession(sessionMd);
  }

  // 5. Read indexed file bodies; omit unreadable/deleted files with a warning.
  const fileContents: Record<string, string> = {};
  const preWarnings: string[] = [];
  for (const f of index.files) {
    const rel = f.path.replace(/\\/g, "/");
    const full = path.join(root, rel);
    try {
      fileContents[rel] = await fs.readFile(full, "utf8");
    } catch {
      preWarnings.push(`Indexed file missing: ${rel}; re-run \`localcoder index\`.`);
    }
  }

  // 6. Build.
  const pkg = buildContext({
    role,
    config,
    index,
    memory,
    task,
    session,
    fileContents,
  });
  // Surface the content-loading warnings ahead of the builder's own.
  pkg.warnings = [...preWarnings, ...pkg.warnings];

  return { pkg, maxContextTokens: config.model.maxContextTokens };
}

function fmtList(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "(none)";
}

export function formatContextResult(result: ContextResult): string {
  const { pkg, maxContextTokens } = result;
  const lines = [
    `Role: ${pkg.role}`,
    `Memory:  ${fmtList(pkg.includedMemoryFiles)}`,
    `Source:  ${fmtList(pkg.includedSourceFiles)}`,
    `Tests:   ${fmtList(pkg.includedTestFiles)}`,
    `Estimated tokens: ${pkg.estimatedTokens.toLocaleString("en-US")} / ${maxContextTokens.toLocaleString("en-US")}`,
  ];
  for (const w of pkg.warnings) lines.push(`! ${w}`);
  return lines.join("\n");
}
