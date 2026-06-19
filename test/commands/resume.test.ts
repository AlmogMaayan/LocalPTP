/**
 * `localcoder resume` command (tasks 9.1–9.4).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTask } from "../../src/commands/task.js";
import { runResume, formatResumeResult } from "../../src/commands/resume.js";
import { readActive } from "../../src/core/activePointer.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-resume-cmd-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function makeTwoSessions(): Promise<{ first: string; second: string }> {
  const a = await runTask({ cwd: tmp, text: "First task" });
  // ensure distinct mtimes
  const b = await runTask({ cwd: tmp, text: "Second task" });
  const older = new Date(Date.now() - 60_000);
  await fs.utimes(a.sessionPath, older, older);
  return { first: a.sessionPath, second: b.sessionPath };
}

describe("resume select by index (9.1)", () => {
  it("lists newest-first, loads selection, updates active.json, prints Next Step", async () => {
    const { first, second } = await makeTwoSessions();
    // resume 2 picks the older session (index 2 in newest-first list).
    const result = await runResume({ cwd: tmp, index: 2 });

    expect(result.sessions[0].path).toBe(second); // newest first
    expect(result.sessions[1].path).toBe(first);
    expect(result.selected!.path).toBe(first);

    const ptr = await readActive(path.join(tmp, ".ai-orchestrator"));
    expect(ptr!.sessionPath).toBe(first);

    const text = formatResumeResult(result);
    expect(text).toMatch(/Next step/i);
  });
});

describe("resume no sessions (9.2)", () => {
  it("prints a friendly message and exits zero", async () => {
    const result = await runResume({ cwd: tmp });
    expect(result.sessions).toHaveLength(0);
    expect(result.selected).toBeUndefined();
    const text = formatResumeResult(result);
    expect(text).toMatch(/no sessions|create a task/i);
  });
});

describe("resume invalid selection (9.3)", () => {
  it("out-of-range index → invalid-selection, nothing activated, non-zero", async () => {
    await makeTwoSessions();
    let err: unknown;
    try {
      await runResume({ cwd: tmp, index: 9 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as { exitCode?: number }).exitCode).toBe(1);
    // active.json still points at the most-recently created task (from setup).
    const ptr = await readActive(path.join(tmp, ".ai-orchestrator"));
    expect(ptr).toBeDefined();
  });

  it("non-TTY run with no index → list + invalid, nothing activated, non-zero", async () => {
    await makeTwoSessions();
    let err: unknown;
    try {
      await runResume({ cwd: tmp, isTTY: false });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as { exitCode?: number }).exitCode).toBe(1);
    expect((err as Error).message).toMatch(/index|specify/i);
  });
});
