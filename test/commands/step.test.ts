/**
 * `localcoder step` — the §3.13 state machine (tasks 7.1-7.9).
 *
 * Offline: a mock ModelClient (never LM Studio) + a real temp git repo, with an
 * injected approver. Each test asserts the side-effect ordering invariant — no
 * write before the apply step, gated by safety + approval.
 */
import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { runStep } from "../../src/commands/step.js";
import { runTask } from "../../src/commands/task.js";
import { parseTask, setSubtasks, serializeTask } from "../../src/core/taskManager.js";
import { readActive } from "../../src/core/activePointer.js";
import { autoApprove, autoDeny, type Approver } from "../../src/core/approval.js";
import { ModelClientError, type ModelClient, type ModelResponse } from "../../src/types/model.js";
import type { Subtask } from "../../src/types/task.js";
import { makeTempRepo } from "../helpers/tempRepo.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function mockClient(content: string): ModelClient {
  return {
    async complete(): Promise<ModelResponse> {
      return { content };
    },
    async health() {
      return { reachable: true, models: ["mock"] };
    },
  };
}

function failingClient(): ModelClient {
  return {
    async complete(): Promise<ModelResponse> {
      throw new ModelClientError(
        "refused",
        "Cannot connect to LM Studio at http://localhost:1234/v1.",
        "http://localhost:1234/v1",
      );
    },
    async health() {
      return { reachable: false };
    },
  };
}

/** Build a temp git repo with a scaffolded active task carrying `subtasks`. */
async function setup(
  files: Record<string, string>,
  subtasks: Subtask[],
): Promise<{ root: string; taskPath: string; sessionPath: string }> {
  const repo = await makeTempRepo(files);
  cleanups.push(repo.cleanup);
  await runTask({ cwd: repo.root, text: "Implement the feature" });
  // Disable the default test commands (npm …) so applied-patch tests do not
  // spawn real npm in the temp repo. Tests that want tests run re-enable them.
  await fs.writeFile(
    path.join(repo.root, ".ai-orchestrator", "config.yml"),
    'commands:\n  typecheck: ""\n  lint: ""\n  test: ""\n  build: ""\n',
    "utf8",
  );
  const ptr = await readActive(path.join(repo.root, ".ai-orchestrator"));
  const task = await parseTask(ptr!.taskPath);
  const edited = setSubtasks(task, subtasks);
  await fs.writeFile(edited.path, serializeTask(edited), "utf8");
  // Commit the newly scaffolded ai/.ai-orchestrator files so the tree is clean.
  await simpleGit(repo.root).add(".").commit("scaffold");
  return { root: repo.root, taskPath: ptr!.taskPath, sessionPath: ptr!.sessionPath };
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

function modifyDiff(rel: string, from: string, to: string): string {
  return [
    `diff --git a/${rel} b/${rel}`,
    `--- a/${rel}`,
    `+++ b/${rel}`,
    `@@ -1,1 +1,1 @@`,
    `-${from}`,
    `+${to}`,
    ``,
  ].join("\n");
}

function addDiff(rel: string, content: string): string {
  return [
    `diff --git a/${rel} b/${rel}`,
    `new file mode 100644`,
    `--- /dev/null`,
    `+++ b/${rel}`,
    `@@ -0,0 +1,1 @@`,
    `+${content}`,
    ``,
  ].join("\n");
}

async function read(root: string, rel: string): Promise<string> {
  return fs.readFile(path.join(root, rel), "utf8");
}

describe("step happy path (7.1)", () => {
  it("valid diff, safe, approved → applied, artifact saved, subtask done, session updated", async () => {
    const { root, taskPath, sessionPath } = await setup(
      { "base.txt": "line one\n" },
      [subtask()],
    );
    const diff = modifyDiff("base.txt", "line one", "line two");
    const result = await runStep({
      cwd: root,
      clientFactory: () => mockClient(diff),
      approve: autoApprove,
    });

    expect(result.applied).toBe(true);
    expect(await read(root, "base.txt")).toBe("line two\n");
    // Patch artifact saved.
    const patchesDir = path.join(root, ".ai-orchestrator", "patches");
    const patches = await fs.readdir(patchesDir);
    expect(patches.length).toBe(1);
    expect(patches[0]).toMatch(/\.patch$/);
    // Subtask marked done.
    const task = await parseTask(taskPath);
    expect(task.subtasks[0].status).toBe("done");
    // Session updated (Changes Made / Next Step touched).
    const session = await fs.readFile(sessionPath, "utf8");
    expect(session).toContain("base.txt");
  });
});

describe("step approval denied (7.2)", () => {
  it("denied → tree unchanged, nothing applied, exit 0", async () => {
    const { root, taskPath } = await setup({ "base.txt": "line one\n" }, [subtask()]);
    const diff = modifyDiff("base.txt", "line one", "line two");
    const result = await runStep({
      cwd: root,
      clientFactory: () => mockClient(diff),
      approve: autoDeny,
    });
    expect(result.applied).toBe(false);
    expect(await read(root, "base.txt")).toBe("line one\n");
    const task = await parseTask(taskPath);
    expect(task.subtasks[0].status).toBe("pending");
  });
});

describe("step risky-path confirm (7.3)", () => {
  it("risky-path diff → second confirm; deny → skip+stop, nothing applied", async () => {
    const { root } = await setup(
      { "src/auth/login.ts": "const x = 1;\n" },
      [subtask({ likelyFiles: ["src/auth/login.ts"] })],
    );
    const diff = modifyDiff("src/auth/login.ts", "const x = 1;", "const x = 2;");
    const result = await runStep({
      cwd: root,
      clientFactory: () => mockClient(diff),
      approve: autoDeny,
    });
    expect(result.applied).toBe(false);
    expect(await read(root, "src/auth/login.ts")).toBe("const x = 1;\n");
  });

  it("require_approval=false still prompts a risky path (deny → not applied)", async () => {
    const { root } = await setup(
      { "src/auth/login.ts": "const x = 1;\n" },
      [subtask({ likelyFiles: ["src/auth/login.ts"] })],
    );
    // Disable approval in config.
    const cfgPath = path.join(root, ".ai-orchestrator", "config.yml");
    await fs.writeFile(cfgPath, "safety:\n  requireApproval: false\n", "utf8");
    const diff = modifyDiff("src/auth/login.ts", "const x = 1;", "const x = 2;");

    const prompts: string[] = [];
    const recordingDeny: Approver = async (p) => {
      prompts.push(p);
      return false;
    };
    const result = await runStep({
      cwd: root,
      clientFactory: () => mockClient(diff),
      approve: recordingDeny,
    });
    expect(result.applied).toBe(false);
    // It DID prompt despite requireApproval=false (risky path).
    expect(prompts.length).toBeGreaterThan(0);
  });

  it("require_approval=false auto-applies a non-risky diff (no prompt)", async () => {
    const { root } = await setup({ "base.txt": "line one\n" }, [subtask()]);
    const cfgPath = path.join(root, ".ai-orchestrator", "config.yml");
    await fs.writeFile(
      cfgPath,
      'safety:\n  requireApproval: false\ncommands:\n  typecheck: ""\n  lint: ""\n  test: ""\n  build: ""\n',
      "utf8",
    );
    const diff = modifyDiff("base.txt", "line one", "line two");

    let prompted = false;
    const approve: Approver = async () => {
      prompted = true;
      return true;
    };
    const result = await runStep({
      cwd: root,
      clientFactory: () => mockClient(diff),
      approve,
    });
    expect(result.applied).toBe(true);
    expect(prompted).toBe(false);
    expect(await read(root, "base.txt")).toBe("line two\n");
  });
});

describe("step delete confirm (7.4)", () => {
  it("delete diff → delete confirm required; deny → not applied", async () => {
    const { root } = await setup({ "base.txt": "line one\n" }, [subtask()]);
    const deleteDiff = [
      `diff --git a/base.txt b/base.txt`,
      `deleted file mode 100644`,
      `--- a/base.txt`,
      `+++ /dev/null`,
      `@@ -1,1 +0,0 @@`,
      `-line one`,
      ``,
    ].join("\n");
    const result = await runStep({
      cwd: root,
      clientFactory: () => mockClient(deleteDiff),
      approve: autoDeny,
    });
    expect(result.applied).toBe(false);
    expect(await read(root, "base.txt")).toBe("line one\n");
  });
});

describe("step refusals (7.5)", () => {
  it("too-many-files diff → refused, nothing applied, non-zero exit", async () => {
    const { root } = await setup(
      {
        "a.txt": "1\n",
        "b.txt": "1\n",
        "c.txt": "1\n",
        "d.txt": "1\n",
        "e.txt": "1\n",
        "f.txt": "1\n",
      },
      [subtask({ likelyFiles: ["a.txt"] })],
    );
    // 6 files > default maxChangedFilesPerStep (5).
    const diff = ["a", "b", "c", "d", "e", "f"]
      .map((n) => modifyDiff(`${n}.txt`, "1", "2"))
      .join("");
    let err: unknown;
    try {
      await runStep({ cwd: root, clientFactory: () => mockClient(diff), approve: autoApprove });
    } catch (e) {
      err = e;
    }
    expect((err as { exitCode?: number }).exitCode).toBe(1);
    expect((err as Error).message).toMatch(/too many|changed files/i);
    expect(await read(root, "a.txt")).toBe("1\n");
  });

  it("binary diff → refused", async () => {
    const { root } = await setup({ "base.txt": "line one\n" }, [subtask()]);
    const diff = [
      `diff --git a/img.png b/img.png`,
      `new file mode 100644`,
      `GIT binary patch`,
      `literal 8`,
      `LcmZQ7=mp&x01`,
      ``,
    ].join("\n");
    let err: unknown;
    try {
      await runStep({ cwd: root, clientFactory: () => mockClient(diff), approve: autoApprove });
    } catch (e) {
      err = e;
    }
    expect((err as { exitCode?: number }).exitCode).toBe(1);
    expect((err as Error).message).toMatch(/binary/i);
  });

  it("path-traversal diff → refused", async () => {
    const { root } = await setup({ "base.txt": "line one\n" }, [subtask()]);
    const diff = modifyDiff("../escape.txt", "x", "y");
    let err: unknown;
    try {
      await runStep({ cwd: root, clientFactory: () => mockClient(diff), approve: autoApprove });
    } catch (e) {
      err = e;
    }
    expect((err as { exitCode?: number }).exitCode).toBe(1);
    expect((err as Error).message).toMatch(/escape|root/i);
  });

  it("ignored-file diff → refused", async () => {
    const { root } = await setup({ "base.txt": "line one\n" }, [subtask()]);
    const diff = modifyDiff("node_modules/p.js", "x", "y");
    let err: unknown;
    try {
      await runStep({ cwd: root, clientFactory: () => mockClient(diff), approve: autoApprove });
    } catch (e) {
      err = e;
    }
    expect((err as { exitCode?: number }).exitCode).toBe(1);
    expect((err as Error).message).toMatch(/ignored|generated/i);
  });
});

describe("step needs_context (7.6)", () => {
  it("needs_context JSON → print + stop, nothing applied, exit 0", async () => {
    const { root } = await setup({ "base.txt": "line one\n" }, [subtask()]);
    const json = JSON.stringify({
      status: "needs_context",
      files: ["src/other.ts"],
      reason: "need to see the caller",
    });
    const result = await runStep({
      cwd: root,
      clientFactory: () => mockClient(json),
      approve: autoApprove,
    });
    expect(result.applied).toBe(false);
    expect(result.needsContext).toBeDefined();
    expect(result.needsContext!.files).toContain("src/other.ts");
    expect(await read(root, "base.txt")).toBe("line one\n");
  });
});

describe("step model/diff errors (7.7)", () => {
  it("§12 model error → nothing applied, non-zero exit", async () => {
    const { root } = await setup({ "base.txt": "line one\n" }, [subtask()]);
    let err: unknown;
    try {
      await runStep({ cwd: root, clientFactory: () => failingClient(), approve: autoApprove });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ModelClientError);
    expect(await read(root, "base.txt")).toBe("line one\n");
  });

  it("empty/invalid diff → nothing applied, non-zero exit", async () => {
    const { root } = await setup({ "base.txt": "line one\n" }, [subtask()]);
    let err: unknown;
    try {
      await runStep({
        cwd: root,
        clientFactory: () => mockClient("I cannot produce a patch."),
        approve: autoApprove,
      });
    } catch (e) {
      err = e;
    }
    expect((err as { exitCode?: number }).exitCode).toBe(1);
    expect(await read(root, "base.txt")).toBe("line one\n");
  });
});

describe("step tests after apply (7.8)", () => {
  it("tests run after apply; a failing test is recorded, patch NOT rolled back", async () => {
    const { root, sessionPath } = await setup({ "base.txt": "line one\n" }, [subtask()]);
    // Configure a failing test command.
    const cfgPath = path.join(root, ".ai-orchestrator", "config.yml");
    await fs.writeFile(
      cfgPath,
      "commands:\n  test: node --eval=process.exit(1)\n  typecheck: \"\"\n  lint: \"\"\n  build: \"\"\n",
      "utf8",
    );
    const diff = modifyDiff("base.txt", "line one", "line two");
    const result = await runStep({
      cwd: root,
      clientFactory: () => mockClient(diff),
      approve: autoApprove,
    });
    expect(result.applied).toBe(true);
    // Patch was NOT rolled back despite the failing test.
    expect(await read(root, "base.txt")).toBe("line two\n");
    expect(result.testResults.some((r) => r.exitCode !== 0)).toBe(true);
    const session = await fs.readFile(sessionPath, "utf8");
    expect(session.toLowerCase()).toMatch(/test|fail/);
  });
});

describe("step no pending subtask (7.9)", () => {
  it("all subtasks done → reports done, exit 0, nothing applied", async () => {
    const { root } = await setup({ "base.txt": "line one\n" }, [
      subtask({ status: "done" }),
    ]);
    const result = await runStep({
      cwd: root,
      clientFactory: () => mockClient("should not be called"),
      approve: autoApprove,
    });
    expect(result.applied).toBe(false);
    expect(result.done).toBe(true);
    expect(await read(root, "base.txt")).toBe("line one\n");
  });
});
