/**
 * `runStep` core (HLD-SRD §3.10, §3.11, §3.13; 0001_06).
 *
 * The single, callable step state machine shared by the `step` command (one
 * shot) and the `run` loop (looped). Extracted from 0001_05's `step` command so
 * one-shot and looped execution share IDENTICAL behavior — the highest-stakes
 * code (patch application) lives in exactly one place.
 *
 * The side-effect ordering is the safety contract: NO write happens before the
 * apply step, and the apply step is reached only after every safety gate and
 * every approval pass.
 *
 *   1. resolve config + active task/session; pick the next pending subtask
 *      (none → done, exit 0, nothing applied).
 *   2. buildContext({ role: 'coder', … }).
 *   3. modelClient.complete(coder prompt). A §12 ModelClientError propagates
 *      unchanged; nothing has been written.
 *   4. needs_context → print files+reason, stop, nothing applied.
 *   5. extractUnifiedDiff → null → §12.3 stop (throws, nothing applied).
 *   6. parsePatch + validate → refuse → throws.
 *   7. safetyManager.evaluate → refuse → throws.
 *   8. assertWorkingTreeSafe → mid-merge → throws.
 *   9. git apply --check (git repos only) → fail → throws.
 *   10. display the diff.
 *   11. risky/delete confirmations → deny → skip+stop, nothing applied.
 *   12. standard approval → deny → stop, nothing applied.
 *   13. apply  — FIRST write.
 *   14. savePatch.
 *   15. run tests, then the bounded TEST-FIX LOOP (0001_06): while a test fails
 *       and attempts < max, ask the test-fixer for a minimal patch and apply it
 *       through the SAME safety + approval + apply + savePatch path, re-running
 *       tests each time. Each fix patch is saved as `<subtask>_fix-N.patch`.
 *       A fix-loop refusal sets a structured stopReason rather than throwing —
 *       the patch is already applied, so the run loop wants a clean stop.
 *   16. update the session + mark the subtask done.
 *
 * Initial-patch refusals still THROW (preserving the 0001_05 `step` behavior);
 * the `run` loop catches them and maps them to stop reasons. Fix-loop refusals
 * carry a `stopReason` on the returned outcome instead.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { detectGitRoot } from "../utils/gitRoot.js";
import { layout } from "../utils/paths.js";
import { readIfExists } from "../utils/fs.js";
import { ConfigManager } from "./configManager.js";
import { loadMemoryFiles } from "./memoryLoader.js";
import { buildContext } from "./contextBuilder.js";
import { resolveActive } from "./activePointer.js";
import { parseTask, setSubtasks, serializeTask } from "./taskManager.js";
import { loadSession, updateSession } from "./sessionManager.js";
import { getPrompt } from "./promptManager.js";
import { LmStudioClient } from "./modelClient.js";
import {
  extractUnifiedDiff,
  parsePatch,
  validate,
  apply,
  savePatch,
  assertWorkingTreeSafe,
  gitApplyCheck,
  PatchValidationError,
  PatchApplyError,
  WorkingTreeUnsafeError,
} from "./patchManager.js";
import { evaluate } from "./safetyManager.js";
import { runTests, splitCommand, formatTestResult, type TestCommand } from "./testRunner.js";
import { ttyApprove, type Approver } from "./approval.js";
import { parseActiveTask, parseActiveSession } from "../types/context.js";
import { repoIndexSchema, type RepoIndex } from "../types/index.js";
import type { ModelClient } from "../types/model.js";
import type { AppConfig } from "../types/config.js";
import type { Subtask } from "../types/task.js";
import type { PatchPlan, SafetyConfirm } from "../types/patch.js";
import type { TestResult } from "../types/test.js";
import type { StepOutcome, StopReason } from "../types/run.js";

/** A command error that carries an exit code (preserves 0001_05 `step` behavior). */
export class CommandError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CommandError";
    this.exitCode = exitCode;
  }
}

export interface NeedsContext {
  files: string[];
  reason: string;
}

export interface StepDeps {
  cwd: string;
  /** Injectable for tests; defaults to the real LM Studio client. */
  clientFactory?: (config: AppConfig) => ModelClient;
  /** Injectable approval seam; defaults to a TTY yes/no prompt. */
  approve?: Approver;
  /** Injectable clock for deterministic patch artifact names. */
  now?: Date;
}

/**
 * The canonical step result: the structured `StepOutcome` (read by the run loop)
 * plus the extra fields the `step` command surfaces (`done`, `needsContext`,
 * `patchPath`).
 */
export interface StepCoreResult extends StepOutcome {
  /** True when there was no pending subtask (task done). */
  done: boolean;
  /** Set when the model returned a `needs_context` request instead of a diff. */
  needsContext?: NeedsContext;
  /** The saved patch artifact path of the coder patch (when applied). */
  patchPath?: string;
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
      // Omit unreadable/deleted files.
    }
  }
  return out;
}

/**
 * Detect a `needs_context` response. Tolerant of fences/prose: scans for a JSON
 * object carrying `"status":"needs_context"` and parses it. Returns the request
 * (files + reason), or undefined when the response is not a needs_context.
 */
export function parseNeedsContext(raw: string): NeedsContext | undefined {
  if (!/"status"\s*:\s*"needs_context"/.test(raw)) return undefined;
  // Scan EVERY balanced top-level object (string/escape aware) and return the
  // first one whose status is needs_context. Scanning only the first `{` breaks
  // when prose before the JSON contains a brace (e.g. "analysis {note}. {…}").
  for (let start = raw.indexOf("{"); start !== -1; start = raw.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
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
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end === -1) continue; // unbalanced from THIS `{` — try the next one
    try {
      const obj = JSON.parse(raw.slice(start, end)) as {
        status?: string;
        files?: unknown;
        reason?: unknown;
      };
      if (obj.status === "needs_context") {
        const files = Array.isArray(obj.files)
          ? obj.files.filter((f): f is string => typeof f === "string")
          : [];
        const reason = typeof obj.reason === "string" ? obj.reason : "";
        return { files, reason };
      }
    } catch {
      // Not valid JSON at this `{` (e.g. prose braces) — try the next object.
    }
  }
  return undefined;
}

/** The confirmation prompt text for a needsConfirm kind. */
function confirmPrompt(kind: SafetyConfirm, plan: PatchPlan): string {
  if (kind === "risky-path") {
    return (
      "WARNING: this patch touches a configured risky path " +
      `(${plan.touchedFiles.join(", ")}). Apply anyway?`
    );
  }
  return `WARNING: this patch DELETES ${plan.deletes.join(", ")}. Apply anyway?`;
}

/** Render the diff for display (the `step` command prints it before approval). */
function displayDiff(diff: string): void {
  process.stdout.write(diff.endsWith("\n") ? diff : diff + "\n");
}

/** Build the configured test commands as arg-array tuples (skips blanks). */
function configuredTestCommands(config: AppConfig): TestCommand[] {
  const out: TestCommand[] = [];
  for (const raw of [
    config.commands.typecheck,
    config.commands.lint,
    config.commands.test,
    config.commands.build,
  ]) {
    const cmd = splitCommand(raw);
    if (cmd) out.push(cmd);
  }
  return out;
}

/** Any failing test in the set? */
function hasFailure(results: TestResult[]): boolean {
  return results.some((r) => r.exitCode !== 0);
}

/** Print a test-results block (the `✓`/`✗` line plus captured output on fail). */
function printTestResults(results: TestResult[]): void {
  for (const r of results) {
    process.stdout.write(formatTestResult(r) + "\n");
    if (r.exitCode !== 0) {
      const out = r.stdout.trimEnd();
      const errOut = r.stderr.trimEnd();
      if (out.length > 0) process.stdout.write(out + "\n");
      if (errOut.length > 0) process.stderr.write(errOut + "\n");
    }
  }
}

/** A compact failure excerpt fed to the test-fixer (capped to avoid bloat). */
function failureExcerpt(results: TestResult[]): string {
  const MAX = 4000;
  const blocks: string[] = [];
  for (const r of results) {
    if (r.exitCode === 0) continue;
    const body = [r.stdout.trimEnd(), r.stderr.trimEnd()].filter((s) => s.length > 0).join("\n");
    blocks.push(`$ ${r.command} (exit ${r.exitCode})\n${body}`);
  }
  const joined = blocks.join("\n\n");
  return joined.length > MAX ? joined.slice(0, MAX) + "\n… [truncated]" : joined;
}

/**
 * The bounded test-fix loop (HLD-SRD §3.11). On a test failure, while
 * `attempts < max`, ask the test-fixer for a minimal patch and apply it through
 * the SAME safety + approval + apply + savePatch path, re-running tests each
 * time. Each fix patch is saved as `<subtaskId>_fix-N.patch`.
 *
 * Returns the final test results, the number of fix attempts made, and an
 * optional `stopReason` set when a fix attempt was refused (unparseable diff,
 * safety verdict, or approval denied). A `repeated-failure` is NOT set here —
 * the caller derives it from the final results + attempts so the
 * `max_failed_fix_attempts = 0` boundary (zero attempts, still failing) is
 * handled uniformly.
 */
async function runFixLoop(args: {
  initialResults: TestResult[];
  commands: TestCommand[];
  config: AppConfig;
  root: string;
  orchestratorDir: string;
  subtaskId: string;
  client: ModelClient;
  approve: Approver;
  now?: Date;
  /**
   * Build the test-fixer user prompt for THIS attempt. Called fresh each
   * iteration so the fixer sees the CURRENT working-tree contents (after the
   * coder patch and any prior fix patches) rather than a pre-patch snapshot.
   */
  buildFixerUserPrompt: () => Promise<string>;
}): Promise<{ results: TestResult[]; fixAttempts: number; stopReason?: StopReason }> {
  const max = args.config.safety.maxFailedFixAttempts;
  let results = args.initialResults;
  let fixAttempts = 0;
  const fixer = getPrompt("test-fixer");

  while (hasFailure(results) && fixAttempts < max) {
    fixAttempts += 1;
    process.stdout.write(
      `\nTests failed — attempting fix ${fixAttempts}/${max}…\n`,
    );

    // Build the test-fixer prompt from the CURRENT working tree plus the
    // failure excerpt (the contents reflect the already-applied patches).
    const fixerUser =
      (await args.buildFixerUserPrompt()) +
      `\n\n## Test failure\n\n${failureExcerpt(results)}`;
    const response = await args.client.complete({
      role: "test-fixer",
      systemPrompt: fixer.system,
      userPrompt: fixer.renderUser(fixerUser),
    });

    // Extract the fix diff. Unparseable → stop the loop with a named reason
    // (nothing half-applied — we have not touched the tree this iteration).
    const diff = extractUnifiedDiff(response.content);
    if (diff === null) {
      process.stdout.write(
        "The test-fixer did not return a valid unified diff. Stopping the fix loop.\n",
      );
      return { results, fixAttempts: fixAttempts - 1, stopReason: "unparseable-output" };
    }

    let plan: PatchPlan;
    try {
      plan = parsePatch(diff);
      await validate(plan, args.config, args.root);
    } catch (err) {
      if (err instanceof PatchValidationError || err instanceof PatchApplyError) {
        process.stdout.write(
          "The test-fixer patch is invalid. Stopping the fix loop. " + err.message + "\n",
        );
        return { results, fixAttempts: fixAttempts - 1, stopReason: "patch-invalid" };
      }
      throw err;
    }

    // Same safety evaluation as a normal patch.
    const verdict = evaluate(plan, args.config, args.root);
    if (verdict.decision === "refuse") {
      process.stdout.write(
        `Refusing the test-fixer patch: ${verdict.reasons.join(" ")} Stopping the fix loop.\n`,
      );
      return { results, fixAttempts: fixAttempts - 1, stopReason: safetyRefusalReason(verdict.reasons) };
    }

    // Working-tree-safe + pre-flight check (git repos).
    try {
      await assertWorkingTreeSafe(args.root);
    } catch (err) {
      if (err instanceof WorkingTreeUnsafeError) {
        return { results, fixAttempts: fixAttempts - 1, stopReason: "unsafe-tree" };
      }
      throw err;
    }
    const git = await detectGitRoot(args.root);
    if (git.isRepo) {
      try {
        await gitApplyCheck(plan, args.root);
      } catch (err) {
        if (err instanceof PatchApplyError) {
          process.stdout.write(
            "The test-fixer patch does not apply cleanly. Stopping the fix loop.\n",
          );
          return { results, fixAttempts: fixAttempts - 1, stopReason: "patch-invalid" };
        }
        throw err;
      }
    }

    displayDiff(diff);

    // Risky/delete confirmations — always prompted, even when requireApproval
    // is false. The SAME gate a normal patch passes through.
    let denied = false;
    for (const kind of verdict.needsConfirm) {
      const ok = await args.approve(confirmPrompt(kind, plan));
      if (!ok) {
        denied = true;
        break;
      }
    }
    if (!denied && args.config.safety.requireApproval && verdict.needsConfirm.length === 0) {
      denied = !(await args.approve("Apply this fix patch?"));
    }
    if (denied) {
      process.stdout.write("Fix not applied: approval denied. Stopping the fix loop.\n");
      return { results, fixAttempts: fixAttempts - 1, stopReason: "approval-denied" };
    }

    // Apply + save the fix patch (as `<subtaskId>_fix-N.patch`).
    await apply(plan, args.root);
    try {
      await savePatch(diff, `${args.subtaskId}_fix-${fixAttempts}`, args.orchestratorDir, {
        now: args.now,
      });
    } catch (err) {
      process.stderr.write(
        "WARNING: the fix patch was applied but its artifact could not be saved: " +
          (err instanceof Error ? err.message : String(err)) +
          "\n",
      );
    }

    // Re-run tests.
    results = await runTests(args.commands, { cwd: args.root });
    printTestResults(results);
  }

  return { results, fixAttempts };
}

/**
 * Map a safety refusal's reasons to the matching stop reason. A risky-path
 * refusal does not actually `refuse` (it is a confirmation), so the refusal set
 * here is binary/escape/ignored/file-cap; the file-cap (broad rewrite) maps to
 * `broad-rewrite-requested`, an unsafe tree to `unsafe-tree`, everything else to
 * the generic `risky-change`.
 */
function safetyRefusalReason(reasons: string[]): StopReason {
  const joined = reasons.join(" ").toLowerCase();
  if (joined.includes("too many changed files")) return "broad-rewrite-requested";
  return "risky-change";
}

export async function runStep(deps: StepDeps): Promise<StepCoreResult> {
  const approve = deps.approve ?? ttyApprove;
  const git = await detectGitRoot(deps.cwd);
  const root = git.root ?? deps.cwd;
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
        'Create a new task with `localptp task "…"` or pick another with `localptp resume`.',
    );
  }
  const { taskPath, sessionPath } = active.pointer;

  const config = await new ConfigManager(l.configFile).load();
  const task = await parseTask(taskPath);
  const session = await loadSession(sessionPath);

  // Pick the next pending subtask (none → done, exit 0, nothing applied).
  const subtask = task.subtasks.find((s) => s.status === "pending");
  if (subtask === undefined) {
    process.stdout.write(
      "No pending subtasks — the task has nothing left to do. Run `localptp plan` to add more.\n",
    );
    return {
      subtaskId: null,
      applied: false,
      done: true,
      testResults: [],
      fixAttempts: 0,
    };
  }

  // 2. Build the coder context.
  const index = await loadIndex(l.orchestratorDir);
  const memory = await loadMemoryFiles(root);
  const fileContents = await loadFileContents(root, index);
  const pkg = buildContext({
    role: "coder",
    config,
    index,
    memory,
    task: parseActiveTask(task.raw),
    session: parseActiveSession(session.raw),
    fileContents,
  });

  // 3. Call the model. A §12 ModelClientError propagates unchanged.
  const client = (deps.clientFactory ?? defaultClientFactory)(config);
  const coder = getPrompt("coder");
  const response = await client.complete({
    role: "coder",
    systemPrompt: coder.system,
    userPrompt: coder.renderUser(pkg.userPrompt),
  });

  // 4. needs_context → print + stop, nothing applied.
  const needs = parseNeedsContext(response.content);
  if (needs !== undefined) {
    process.stdout.write(
      `The model needs more context before it can patch:\n` +
        `  reason: ${needs.reason}\n` +
        (needs.files.length > 0 ? `  files: ${needs.files.join(", ")}\n` : "") +
        "Nothing was applied.\n",
    );
    return {
      subtaskId: subtask.id,
      applied: false,
      done: false,
      needsContext: needs,
      // Stop the `run` loop with a meaningful reason: nothing changed, so a
      // re-run would produce the same needs_context and spin to the iteration
      // cap. `step` reads `needsContext` (not `stopReason`), so its output is
      // unchanged.
      stopReason: "needs-context",
      testResults: [],
      fixAttempts: 0,
    };
  }

  // 5. Extract the unified diff. null → §12.3 stop, nothing applied.
  const diff = extractUnifiedDiff(response.content);
  if (diff === null) {
    throw new CommandError(
      "The model did not return a valid unified diff (§12.3). Nothing was applied. " +
        "Try `localptp step` again or narrow the subtask.",
    );
  }

  // 6. Parse + validate.
  const plan = parsePatch(diff);
  await validate(plan, config, root);

  // 7. Pure safety evaluation.
  const verdict = evaluate(plan, config, root);
  if (verdict.decision === "refuse") {
    throw new CommandError(`Refusing to apply: ${verdict.reasons.join(" ")}`);
  }

  // 8. Working-tree-safe.
  await assertWorkingTreeSafe(root);

  // 9. Pre-flight `git apply --check` BEFORE displaying/prompting.
  if (git.isRepo) {
    await gitApplyCheck(plan, root);
  }

  // 10. Display the diff.
  displayDiff(diff);

  // 11. Risky/delete confirmations — always prompted. Deny → skip + stop.
  for (const kind of verdict.needsConfirm) {
    const ok = await approve(confirmPrompt(kind, plan));
    if (!ok) {
      process.stdout.write("Skipped: confirmation denied. Nothing was applied.\n");
      return {
        subtaskId: subtask.id,
        applied: false,
        done: false,
        stopReason: "approval-denied",
        testResults: [],
        fixAttempts: 0,
      };
    }
  }

  // 12. Standard approval — unless requireApproval is false AND no confirmations.
  if (config.safety.requireApproval && verdict.needsConfirm.length === 0) {
    const ok = await approve("Apply this patch?");
    if (!ok) {
      process.stdout.write("Not applied: approval denied. Nothing was changed.\n");
      return {
        subtaskId: subtask.id,
        applied: false,
        done: false,
        stopReason: "approval-denied",
        testResults: [],
        fixAttempts: 0,
      };
    }
  }

  // 13. Apply — the FIRST write.
  await apply(plan, root);

  // 14. Save the patch artifact.
  let patchPath: string | undefined;
  try {
    patchPath = await savePatch(diff, subtask.id, l.orchestratorDir, {
      now: deps.now,
    });
  } catch (err) {
    process.stderr.write(
      "WARNING: the patch was applied but the patch artifact could not be saved: " +
        (err instanceof Error ? err.message : String(err)) +
        "\n",
    );
  }

  // 15. Run configured tests, then the bounded test-fix loop (0001_06).
  const commands = configuredTestCommands(config);
  let testResults = await runTests(commands, { cwd: root });
  printTestResults(testResults);

  let fixAttempts = 0;
  let stopReason: StopReason | undefined;
  if (hasFailure(testResults)) {
    const fixed = await runFixLoop({
      initialResults: testResults,
      commands,
      config,
      root,
      orchestratorDir: l.orchestratorDir,
      subtaskId: subtask.id,
      client,
      approve,
      now: deps.now,
      // Rebuild a fresh test-fixer context each attempt from the CURRENT
      // working tree so the fixer never sees stale, pre-patch file contents.
      buildFixerUserPrompt: async () => {
        const freshContents = await loadFileContents(root, index);
        const fixerPkg = buildContext({
          role: "test-fixer",
          config,
          index,
          memory,
          task: parseActiveTask(task.raw),
          session: parseActiveSession(session.raw),
          fileContents: freshContents,
        });
        return fixerPkg.userPrompt;
      },
    });
    testResults = fixed.results;
    fixAttempts = fixed.fixAttempts;
    stopReason = fixed.stopReason;
    // Tests still failing after exhausting the attempt budget → repeated-failure.
    if (
      stopReason === undefined &&
      hasFailure(testResults) &&
      fixAttempts >= config.safety.maxFailedFixAttempts
    ) {
      stopReason = "repeated-failure";
    }
  }

  // 16. Update the session + mark the subtask done.
  await recordOutcome({
    taskPath,
    session,
    subtask,
    plan,
    patchPath,
    testResults,
    task,
    now: deps.now,
  });

  return {
    subtaskId: subtask.id,
    applied: true,
    done: false,
    patchPath,
    testResults,
    fixAttempts,
    ...(stopReason !== undefined ? { stopReason } : {}),
  };
}

interface OutcomeInputs {
  taskPath: string;
  session: Awaited<ReturnType<typeof loadSession>>;
  subtask: Subtask;
  plan: PatchPlan;
  patchPath?: string;
  testResults: TestResult[];
  task: Awaited<ReturnType<typeof parseTask>>;
  now?: Date;
}

/** Persist the step outcome — task first (mark subtask done), then session. */
async function recordOutcome(o: OutcomeInputs): Promise<void> {
  const updatedSubtasks = o.task.subtasks.map((s) =>
    s.id === o.subtask.id ? { ...s, status: "done" as const } : s,
  );
  const editedTask = setSubtasks(o.task, updatedSubtasks);
  await fs.writeFile(editedTask.path, serializeTask(editedTask), "utf8");

  const changeLines = o.plan.touchedFiles.map((f) => {
    const op = o.plan.adds.includes(f)
      ? "add"
      : o.plan.deletes.includes(f)
        ? "delete"
        : "modify";
    return `- ${f} (${op})`;
  });
  const testLines = o.testResults.map(
    (r) => `- ${r.exitCode === 0 ? "PASS" : "FAIL"} ${r.command} (exit ${r.exitCode})`,
  );
  const anyFail = o.testResults.some((r) => r.exitCode !== 0);

  const next = o.task.subtasks.find(
    (s) => s.id !== o.subtask.id && s.status === "pending",
  );
  const nextStep = next
    ? `${next.id}: ${next.title}`
    : "All subtasks complete. Run `localptp summarize` (0001_07) or close the task.";

  const currentState =
    `Applied ${o.subtask.id} (${o.subtask.title}).\n\n` +
    `Changes:\n${changeLines.join("\n") || "- (none)"}\n` +
    (o.patchPath ? `\nPatch artifact: ${o.patchPath}\n` : "") +
    (testLines.length > 0
      ? `\nTests:\n${testLines.join("\n")}${anyFail ? "\n(One or more tests FAILED — patch not rolled back; Git is the manual rollback.)" : ""}\n`
      : "");

  const risks = anyFail
    ? ["Tests failed after applying the patch; the change was not rolled back."]
    : [];

  await updateSession(
    o.session,
    {
      currentState,
      nextStep,
      ...(risks.length > 0 ? { risks } : {}),
    },
    { now: o.now },
  );
}
