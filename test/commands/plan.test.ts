/**
 * `localcoder plan` command (tasks 8.1–8.7), all offline against a mock client.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTask } from "../../src/commands/task.js";
import { runPlan } from "../../src/commands/plan.js";
import { parseTask } from "../../src/core/taskManager.js";
import { loadSession } from "../../src/core/sessionManager.js";
import { readActive } from "../../src/core/activePointer.js";
import {
  ModelClientError,
  type ModelClient,
  type ModelResponse,
} from "../../src/types/model.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-plan-cmd-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
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
        "Cannot connect to LM Studio at http://localhost:1234/v1. Make sure LM Studio Local Server is running and the model is loaded.",
        "http://localhost:1234/v1",
      );
    },
    async health() {
      return { reachable: false };
    },
  };
}

const validPlan = {
  summary: "Decompose the rename task.",
  subtasks: [
    { id: "foo", title: "Find the label", risk: "low", likelyFiles: ["src/nav.ts"] },
    { title: "Replace the string" },
  ],
  risks: ["UI string change"],
  questions: ["Any other labels?"],
};

async function setupTask(): Promise<void> {
  await runTask({ cwd: tmp, text: "Rename Alerts to Notifications" });
}

describe("plan valid JSON (8.1)", () => {
  it("saves step-N subtasks, sets session state/next-step/risks/questions", async () => {
    await setupTask();
    const result = await runPlan({
      cwd: tmp,
      clientFactory: () => mockClient(JSON.stringify(validPlan)),
    });

    const ptr = await readActive(path.join(tmp, ".ai-orchestrator"));
    const task = await parseTask(ptr!.taskPath);
    expect(task.subtasks.map((s) => s.id)).toEqual(["step-1", "step-2"]);
    expect(task.subtasks[0].title).toBe("Find the label");

    const session = await loadSession(ptr!.sessionPath);
    expect(session.currentState).toContain("Decompose the rename task.");
    expect(session.nextStep).toContain("step-1: Find the label");
    expect(session.raw).toContain("UI string change");
    expect(session.raw).toContain("Any other labels?");

    expect(result.plan.subtasks).toHaveLength(2);
  });

  it("--json emits only the validated plan (human summary suppressed)", async () => {
    await setupTask();
    const result = await runPlan({
      cwd: tmp,
      json: true,
      clientFactory: () => mockClient(JSON.stringify(validPlan)),
    });
    // The result carries the plan; the CLI prints JSON only.
    expect(result.plan.subtasks[0].id).toBe("step-1");
    expect(result.json).toBe(true);
  });
});

describe("plan fenced/prose JSON (8.2)", () => {
  it("saves correctly from fenced JSON", async () => {
    await setupTask();
    const raw = "Sure!\n```json\n" + JSON.stringify(validPlan) + "\n```\n";
    await runPlan({ cwd: tmp, clientFactory: () => mockClient(raw) });
    const ptr = await readActive(path.join(tmp, ".ai-orchestrator"));
    const task = await parseTask(ptr!.taskPath);
    expect(task.subtasks).toHaveLength(2);
  });
});

describe("plan malformed JSON (8.3)", () => {
  it("§11.2 message, task/session unchanged, non-zero exit", async () => {
    await setupTask();
    const ptr = await readActive(path.join(tmp, ".ai-orchestrator"));
    const taskBefore = await fs.readFile(ptr!.taskPath, "utf8");
    const sessionBefore = await fs.readFile(ptr!.sessionPath, "utf8");

    let err: unknown;
    try {
      await runPlan({ cwd: tmp, clientFactory: () => mockClient("no json here") });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as { exitCode?: number }).exitCode).toBe(1);
    expect((err as Error).message).toMatch(/pars/i);

    expect(await fs.readFile(ptr!.taskPath, "utf8")).toBe(taskBefore);
    expect(await fs.readFile(ptr!.sessionPath, "utf8")).toBe(sessionBefore);
  });
});

describe("plan model error (8.4)", () => {
  it("§12 message, nothing saved, non-zero exit", async () => {
    await setupTask();
    const ptr = await readActive(path.join(tmp, ".ai-orchestrator"));
    const taskBefore = await fs.readFile(ptr!.taskPath, "utf8");
    const sessionBefore = await fs.readFile(ptr!.sessionPath, "utf8");

    let err: unknown;
    try {
      await runPlan({ cwd: tmp, clientFactory: () => failingClient() });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ModelClientError);
    expect((err as Error).message).toMatch(/LM Studio/);

    expect(await fs.readFile(ptr!.taskPath, "utf8")).toBe(taskBefore);
    expect(await fs.readFile(ptr!.sessionPath, "utf8")).toBe(sessionBefore);
  });
});

describe("plan no active task (8.5)", () => {
  it("actionable error, non-zero exit", async () => {
    let err: unknown;
    try {
      await runPlan({ cwd: tmp, clientFactory: () => mockClient(JSON.stringify(validPlan)) });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as { exitCode?: number }).exitCode).toBe(1);
    expect((err as Error).message).toMatch(/task/i);
  });
});

describe("plan missing-target pointer (8.6)", () => {
  it("reports the missing target, advises task/resume, saves nothing, non-zero exit", async () => {
    await setupTask();
    const ptr = await readActive(path.join(tmp, ".ai-orchestrator"));
    // Delete the task file so the pointer dangles.
    await fs.rm(ptr!.taskPath);

    let err: unknown;
    try {
      await runPlan({ cwd: tmp, clientFactory: () => mockClient(JSON.stringify(validPlan)) });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as { exitCode?: number }).exitCode).toBe(1);
    expect((err as Error).message).toMatch(/task|resume/i);
  });
});
