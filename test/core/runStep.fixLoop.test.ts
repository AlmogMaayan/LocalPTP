/**
 * Bounded test-fix loop inside `runStep` (tasks 3.1-3.4).
 *
 * Offline: a SCRIPTED mock ModelClient returning a coder diff first, then fix
 * diffs on subsequent calls, against a real temp git repo. Each fix patch still
 * flows through approval + safety + apply + savePatch.
 *
 * The configured test passes only once a `marker.txt` exists, so the coder patch
 * (which edits base.txt) leaves it failing and a fix patch (which adds marker)
 * repairs it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { runStep } from "../../src/core/runStep.js";
import { runTask } from "../../src/commands/task.js";
import { parseTask, setSubtasks, serializeTask } from "../../src/core/taskManager.js";
import { readActive } from "../../src/core/activePointer.js";
import { autoApprove, autoDeny, type Approver } from "../../src/core/approval.js";
import type { ModelClient, ModelResponse } from "../../src/types/model.js";
import type { Subtask } from "../../src/types/task.js";
import { makeTempRepo, buildModifyDiff, buildAddDiff } from "../helpers/tempRepo.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** A client that returns each scripted response in order; repeats the last. */
function scriptedClient(responses: string[]): ModelClient {
  let i = 0;
  return {
    async complete(): Promise<ModelResponse> {
      const content = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return { content };
    },
    async health() {
      return { reachable: true, models: ["mock"] };
    },
  };
}

/** The marker-presence test command (exit 0 iff marker.txt exists). */
const MARKER_TEST = "node -e process.exit(require('fs').existsSync('marker.txt')?0:1)";

/**
 * Build a temp git repo with an active task carrying `subtasks` and a config that
 * runs only the supplied test command and `maxFailedFixAttempts`.
 */
async function setup(
  files: Record<string, string>,
  subtasks: Subtask[],
  opts: { testCmd: string; maxFixAttempts: number },
): Promise<{ root: string; orchestratorDir: string }> {
  const repo = await makeTempRepo(files);
  cleanups.push(repo.cleanup);
  await runTask({ cwd: repo.root, text: "Implement the feature" });
  const cfg =
    `safety:\n  maxFailedFixAttempts: ${opts.maxFixAttempts}\n` +
    `commands:\n  typecheck: ""\n  lint: ""\n  test: ${opts.testCmd}\n  build: ""\n`;
  await fs.writeFile(
    path.join(repo.root, ".ai-orchestrator", "config.yml"),
    cfg,
    "utf8",
  );
  const ptr = await readActive(path.join(repo.root, ".ai-orchestrator"));
  const task = await parseTask(ptr!.taskPath);
  const edited = setSubtasks(task, subtasks);
  await fs.writeFile(edited.path, serializeTask(edited), "utf8");
  await simpleGit(repo.root).add(".").commit("scaffold");
  return { root: repo.root, orchestratorDir: path.join(repo.root, ".ai-orchestrator") };
}

function subtask(over: Partial<Subtask> = {}): Subtask {
  return {
    id: over.id ?? "step-1",
    title: over.title ?? "Edit base",
    description: over.description ?? "",
    status: over.status ?? "pending",
    risk: over.risk ?? "low",
    likelyFiles: over.likelyFiles ?? ["base.txt"],
    acceptanceCriteria: over.acceptanceCriteria,
  };
}

async function patchNames(orchestratorDir: string): Promise<string[]> {
  const dir = path.join(orchestratorDir, "patches");
  try {
    return (await fs.readdir(dir)).sort();
  } catch {
    return [];
  }
}

describe("test-fix loop — repair (3.1)", () => {
  it("failing test → fix patch (approved) → re-run passes; fix saved as _fix-1", async () => {
    const { root, orchestratorDir } = await setup(
      { "base.txt": "line one\n" },
      [subtask()],
      { testCmd: MARKER_TEST, maxFixAttempts: 2 },
    );
    const coder = buildModifyDiff("base.txt", "line one", "line two");
    const fix = buildAddDiff("marker.txt", "ok");
    const result = await runStep({
      cwd: root,
      clientFactory: () => scriptedClient([coder, fix]),
      approve: autoApprove,
    });

    expect(result.applied).toBe(true);
    expect(result.fixAttempts).toBe(1);
    expect(result.stopReason).toBeUndefined();
    // Final tests pass.
    expect(result.testResults.every((r) => r.exitCode === 0)).toBe(true);
    // The fix file was applied.
    expect(await fs.readFile(path.join(root, "marker.txt"), "utf8")).toBe("ok\n");
    // The coder patch + the fix-1 patch are both saved.
    const names = await patchNames(orchestratorDir);
    expect(names.some((n) => n.includes("step-1_fix-1"))).toBe(true);
    expect(names.some((n) => /step-1\.patch$|step-1-\d/.test(n))).toBe(true);
  });
});

describe("test-fix loop — persistent failure (3.2)", () => {
  it("never-passing → stops after maxFailedFixAttempts; fix-N saved; repeated-failure", async () => {
    const { root, orchestratorDir } = await setup(
      { "base.txt": "line one\n", "other.txt": "a\n" },
      [subtask()],
      { testCmd: MARKER_TEST, maxFixAttempts: 2 },
    );
    const coder = buildModifyDiff("base.txt", "line one", "line two");
    // Each fix edits other.txt to a new value but never creates marker.txt, so
    // the test keeps failing. The fix must apply cleanly each time, so chain the
    // edits.
    const fix1 = buildModifyDiff("other.txt", "a", "b");
    const fix2 = buildModifyDiff("other.txt", "b", "c");
    const result = await runStep({
      cwd: root,
      clientFactory: () => scriptedClient([coder, fix1, fix2]),
      approve: autoApprove,
    });

    expect(result.applied).toBe(true);
    expect(result.fixAttempts).toBe(2);
    expect(result.stopReason).toBe("repeated-failure");
    expect(result.testResults.some((r) => r.exitCode !== 0)).toBe(true);
    const names = await patchNames(orchestratorDir);
    expect(names.some((n) => n.includes("step-1_fix-1"))).toBe(true);
    expect(names.some((n) => n.includes("step-1_fix-2"))).toBe(true);
  });

  it("maxFailedFixAttempts = 0 → zero repair attempts, repeated-failure, no fix patches", async () => {
    const { root, orchestratorDir } = await setup(
      { "base.txt": "line one\n" },
      [subtask()],
      { testCmd: MARKER_TEST, maxFixAttempts: 0 },
    );
    const coder = buildModifyDiff("base.txt", "line one", "line two");
    const result = await runStep({
      cwd: root,
      clientFactory: () => scriptedClient([coder, buildAddDiff("marker.txt", "ok")]),
      approve: autoApprove,
    });
    expect(result.applied).toBe(true);
    expect(result.fixAttempts).toBe(0);
    expect(result.stopReason).toBe("repeated-failure");
    const names = await patchNames(orchestratorDir);
    expect(names.some((n) => n.includes("_fix-"))).toBe(false);
  });
});

describe("test-fix loop — risky fix still gated (3.3)", () => {
  it("a fix patch touching a risky path triggers the risky-path confirmation", async () => {
    const { root } = await setup(
      { "base.txt": "line one\n" },
      [subtask()],
      { testCmd: MARKER_TEST, maxFixAttempts: 2 },
    );
    const coder = buildModifyDiff("base.txt", "line one", "line two");
    // The fix creates a file under a risky path (auth) — must prompt.
    const riskyFix = buildAddDiff("src/auth/marker.txt", "ok");

    const prompts: string[] = [];
    const recordingApprove: Approver = async (p) => {
      prompts.push(p);
      return true;
    };
    const result = await runStep({
      cwd: root,
      clientFactory: () => scriptedClient([coder, riskyFix]),
      approve: recordingApprove,
    });
    // It prompted with a risky-path warning during the fix.
    expect(prompts.some((p) => /risky path/i.test(p))).toBe(true);
    expect(result.fixAttempts).toBe(1);
  });

  it("a risky fix denied → fix loop stops with approval-denied, fix not applied", async () => {
    const { root } = await setup(
      { "base.txt": "line one\n" },
      [subtask()],
      { testCmd: MARKER_TEST, maxFixAttempts: 2 },
    );
    const coder = buildModifyDiff("base.txt", "line one", "line two");
    const riskyFix = buildAddDiff("src/auth/marker.txt", "ok");
    const result = await runStep({
      cwd: root,
      clientFactory: () => scriptedClient([coder, riskyFix]),
      approve: autoDeny,
    });
    expect(result.stopReason).toBe("approval-denied");
    // The risky fix file was NOT created.
    let exists = true;
    try {
      await fs.access(path.join(root, "src/auth/marker.txt"));
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});

describe("test-fix loop — unparseable fix (3.4)", () => {
  it("unparseable fix diff → loop stops with unparseable-output, nothing half-applied", async () => {
    const { root } = await setup(
      { "base.txt": "line one\n" },
      [subtask()],
      { testCmd: MARKER_TEST, maxFixAttempts: 2 },
    );
    const coder = buildModifyDiff("base.txt", "line one", "line two");
    const result = await runStep({
      cwd: root,
      clientFactory: () => scriptedClient([coder, "I cannot produce a patch, sorry."]),
      approve: autoApprove,
    });
    expect(result.stopReason).toBe("unparseable-output");
    expect(result.fixAttempts).toBe(0);
    // The coder patch is applied, but no marker / half-applied fix.
    expect(await fs.readFile(path.join(root, "base.txt"), "utf8")).toBe("line two\n");
    let exists = true;
    try {
      await fs.access(path.join(root, "marker.txt"));
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});
