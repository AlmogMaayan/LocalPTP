/**
 * Session Manager (tasks 3.1–3.3).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTask } from "../../src/core/taskManager.js";
import {
  createSession,
  updateSession,
  loadSession,
  listSessions,
} from "../../src/core/sessionManager.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-session-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const tasksDir = (): string => path.join(tmp, "ai", "tasks");
const sessionsDir = (): string => path.join(tmp, "ai", "sessions");

describe("createSession / updateSession / loadSession (3.1)", () => {
  it("creates a §3.6 session referencing the task and round-trips", async () => {
    const task = await createTask(tasksDir(), "Add severity", {
      now: new Date("2026-06-18T10:15:00"),
    });
    const session = await createSession(sessionsDir(), task, {
      now: new Date("2026-06-18T10:15:00"),
    });

    expect(session.path).toMatch(
      /2026-06-18_1015_add-severity_session\.md$/,
    );
    expect(session.taskPath).toBe(task.path);
    expect(session.status).toBe("active");

    const body = await fs.readFile(session.path, "utf8");
    expect(body).toMatch(/^# Session: Add severity/m);
    expect(body).toContain(`Task: ${task.path}`);
    expect(body).toMatch(/## Objective/);
    expect(body).toMatch(/## Current State/);
    expect(body).toMatch(/## Next Step/);

    // update Current State / Next Step / Risks / Decisions
    const updated = await updateSession(session, {
      currentState: "Plan generated.",
      nextStep: "step-1: Inspect",
      risks: ["DB migration is risky"],
      decisions: ["Q: Which thresholds?"],
    });
    expect(updated.currentState).toBe("Plan generated.");
    expect(updated.nextStep).toBe("step-1: Inspect");

    const reloaded = await loadSession(session.path);
    expect(reloaded.currentState).toBe("Plan generated.");
    expect(reloaded.nextStep).toBe("step-1: Inspect");
    expect(reloaded.taskPath).toBe(task.path);
    const reloadedBody = reloaded.raw;
    expect(reloadedBody).toContain("DB migration is risky");
    expect(reloadedBody).toContain("Which thresholds?");
  });
});

describe("listSessions (3.2)", () => {
  it("returns newest-first with status + next-step preview", async () => {
    const t1 = await createTask(tasksDir(), "First task", {
      now: new Date("2026-06-18T09:30:00"),
    });
    const s1 = await createSession(sessionsDir(), t1, {
      now: new Date("2026-06-18T09:30:00"),
    });
    await updateSession(s1, { nextStep: "step-1: do first thing" });

    const t2 = await createTask(tasksDir(), "Second task", {
      now: new Date("2026-06-18T10:15:00"),
    });
    const s2 = await createSession(sessionsDir(), t2, {
      now: new Date("2026-06-18T10:15:00"),
    });
    await updateSession(s2, { nextStep: "step-2: do second thing" });

    // Force deterministic mtimes: s2 newer than s1.
    await fs.utimes(s1.path, new Date("2026-06-18T09:30:00"), new Date("2026-06-18T09:30:00"));
    await fs.utimes(s2.path, new Date("2026-06-18T10:15:00"), new Date("2026-06-18T10:15:00"));

    const list = await listSessions(sessionsDir());
    expect(list).toHaveLength(2);
    expect(list[0].path).toBe(s2.path);
    expect(list[1].path).toBe(s1.path);
    expect(list[0].status).toBe("active");
    expect(list[0].nextStep).toContain("step-2");
  });

  it("returns an empty array when the sessions dir is missing", async () => {
    const list = await listSessions(path.join(tmp, "ai", "nope"));
    expect(list).toEqual([]);
  });
});
