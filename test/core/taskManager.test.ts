/**
 * Task Manager (tasks 2.1–2.4).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  slugify,
  createTask,
  parseTask,
  serializeTask,
  setSubtasks,
} from "../../src/core/taskManager.js";
import type { Subtask } from "../../src/types/task.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-task-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const tasksDir = (): string => path.join(tmp, "ai", "tasks");

describe("slugify (2.1)", () => {
  it("kebab-cases simple words", () => {
    expect(slugify("Rename the Alerts label")).toBe("rename-the-alerts-label");
  });

  it("strips quotes and special chars to ASCII kebab", () => {
    expect(slugify(`Rename the 'Alerts' nav label!!!`)).toBe(
      "rename-the-alerts-nav-label",
    );
  });

  it("transliterates / strips unicode", () => {
    const s = slugify("Café déjà — vu");
    expect(s).toMatch(/^[a-z0-9-]+$/);
    expect(s.length).toBeGreaterThan(0);
  });

  it("limits to ~6 words", () => {
    const s = slugify("one two three four five six seven eight");
    expect(s.split("-").length).toBeLessThanOrEqual(6);
  });

  it("empty / all-special input falls back to `task`", () => {
    expect(slugify("")).toBe("task");
    expect(slugify("!!!@@@###")).toBe("task");
  });
});

describe("createTask (2.2)", () => {
  it("writes a §3.5 file with goal, active status, empty subtasks", async () => {
    const task = await createTask(tasksDir(), "Rename the 'Alerts' label", {
      now: new Date("2026-06-18T09:30:00"),
    });
    expect(task.path).toMatch(/2026-06-18_0930_rename-the-alerts-label\.md$/);
    const body = await fs.readFile(task.path, "utf8");
    expect(body).toMatch(/^# Task: Rename the 'Alerts' label/m);
    expect(body).toMatch(/Status: active/);
    expect(body).toMatch(/## Goal\nRename the 'Alerts' label/);
    expect(body).toMatch(/## Subtasks/);
    expect(task.goal).toBe("Rename the 'Alerts' label");
    expect(task.status).toBe("active");
    expect(task.subtasks).toEqual([]);
  });

  it("collision yields a -2 suffix and does not overwrite", async () => {
    const now = new Date("2026-06-18T09:30:00");
    const a = await createTask(tasksDir(), "Same text", { now });
    const b = await createTask(tasksDir(), "Same text", { now });
    expect(a.path).not.toBe(b.path);
    expect(b.path).toMatch(/-2\.md$/);
    // the first file still has its original content
    const aBody = await fs.readFile(a.path, "utf8");
    expect(aBody).toMatch(/# Task: Same text/);
  });

  it("preserves verbatim goal with special chars while slug is sanitized", async () => {
    const text = `Add severity (low/med/high) — "campaign" alerts`;
    const task = await createTask(tasksDir(), text, {
      now: new Date("2026-06-18T10:15:00"),
    });
    expect(path.basename(task.path)).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}_[a-z0-9-]+\.md$/);
    const body = await fs.readFile(task.path, "utf8");
    expect(body).toContain(text);
  });
});

describe("parseTask / serializeTask / setSubtasks (2.3)", () => {
  const subtasks: Subtask[] = [
    {
      id: "step-1",
      title: "Inspect alert generation",
      description: "Read engine",
      status: "pending",
      risk: "low",
      likelyFiles: ["src/alertEngine.ts"],
      acceptanceCriteria: ["understood"],
    },
    {
      id: "step-2",
      title: "Add severity type",
      description: "",
      status: "pending",
      risk: "high",
      likelyFiles: [],
    },
  ];

  it("round-trips: setSubtasks rewrites only ## Subtasks, preserving other content", async () => {
    const task = await createTask(tasksDir(), "Add severity", {
      now: new Date("2026-06-18T10:15:00"),
    });
    // Inject extra user content outside ## Subtasks.
    const withNotes = task.raw.replace(
      "## Goal",
      "## Background\nSome custom user notes.\n\n## Goal",
    );
    await fs.writeFile(task.path, withNotes, "utf8");

    const reread = await parseTask(task.path);
    const edited = setSubtasks(reread, subtasks);
    await fs.writeFile(edited.path, serializeTask(edited), "utf8");

    const finalBody = await fs.readFile(task.path, "utf8");
    expect(finalBody).toContain("## Background\nSome custom user notes.");
    expect(finalBody).toContain("step-1");
    expect(finalBody).toContain("step-2");

    const parsed = await parseTask(task.path);
    expect(parsed.subtasks).toHaveLength(2);
    expect(parsed.subtasks[0].id).toBe("step-1");
    expect(parsed.subtasks[0].title).toBe("Inspect alert generation");
    expect(parsed.subtasks[0].risk).toBe("low");
    expect(parsed.subtasks[0].likelyFiles).toEqual(["src/alertEngine.ts"]);
    expect(parsed.subtasks[1].risk).toBe("high");
    expect(parsed.title).toBe("Add severity");
    expect(parsed.status).toBe("active");
  });

  it("re-running setSubtasks replaces the prior block, preserving the rest", async () => {
    const task = await createTask(tasksDir(), "Demo", {
      now: new Date("2026-06-18T10:15:00"),
    });
    let t = setSubtasks(task, subtasks);
    await fs.writeFile(t.path, serializeTask(t), "utf8");
    t = await parseTask(t.path);
    const replaced = setSubtasks(t, [subtasks[0]]);
    await fs.writeFile(replaced.path, serializeTask(replaced), "utf8");
    const reparsed = await parseTask(replaced.path);
    expect(reparsed.subtasks).toHaveLength(1);
    expect(reparsed.subtasks[0].id).toBe("step-1");
  });
});
