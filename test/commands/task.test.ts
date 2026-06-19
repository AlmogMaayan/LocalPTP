/**
 * `localcoder task` command (tasks 7.1–7.2).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTask, formatTaskResult } from "../../src/commands/task.js";
import { readActive } from "../../src/core/activePointer.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-task-cmd-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("runTask (7.1)", () => {
  it("creates task + session files + active.json and prints paths + status", async () => {
    const result = await runTask({
      cwd: tmp,
      text: "Rename the 'Alerts' nav label to 'Notifications'",
    });

    // Files exist.
    const taskBody = await fs.readFile(result.taskPath, "utf8");
    const sessionBody = await fs.readFile(result.sessionPath, "utf8");
    expect(taskBody).toMatch(/# Task: Rename the 'Alerts' nav label/);
    expect(sessionBody).toContain(`Task: ${result.taskPath}`);
    expect(result.taskPath).toMatch(/[/\\]ai[/\\]tasks[/\\]/);
    expect(result.sessionPath).toMatch(/[/\\]ai[/\\]sessions[/\\]/);

    // active.json points at both.
    const ptr = await readActive(path.join(tmp, ".ai-orchestrator"));
    expect(ptr).toEqual({
      taskPath: result.taskPath,
      sessionPath: result.sessionPath,
    });

    // Output mentions paths + active status.
    const text = formatTaskResult(result);
    expect(text).toContain(result.taskPath);
    expect(text).toContain(result.sessionPath);
    expect(text).toMatch(/active/i);
  });

  it("rejects an empty task string with a non-zero exit", async () => {
    let err: unknown;
    try {
      await runTask({ cwd: tmp, text: "   " });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as { exitCode?: number }).exitCode).toBe(1);
  });
});
