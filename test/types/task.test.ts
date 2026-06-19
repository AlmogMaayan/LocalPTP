/**
 * Task type shapes (task 1.1).
 */
import { describe, it, expect } from "vitest";
import type {
  Task,
  Subtask,
  TaskStatus,
  SubtaskStatus,
  Risk,
} from "../../src/types/task.js";

describe("task types (1.1)", () => {
  it("a Task with a Subtask is structurally valid", () => {
    const status: TaskStatus = "active";
    const subStatus: SubtaskStatus = "pending";
    const risk: Risk = "medium";

    const subtask: Subtask = {
      id: "step-1",
      title: "Inspect alert generation",
      description: "Read the current alert engine.",
      status: subStatus,
      risk,
      likelyFiles: ["src/alertEngine.ts"],
      acceptanceCriteria: ["engine understood"],
    };

    const task: Task = {
      path: "/ai/tasks/2026-06-18_0930_demo.md",
      title: "Demo",
      status,
      goal: "Demo the thing.",
      subtasks: [subtask],
      raw: "# Task: Demo\n",
    };

    expect(task.subtasks[0].id).toBe("step-1");
    expect(task.status).toBe("active");
    expect(task.subtasks[0].risk).toBe("medium");
  });

  it("a Subtask may omit acceptanceCriteria", () => {
    const subtask: Subtask = {
      id: "step-2",
      title: "Add type",
      description: "",
      status: "done",
      risk: "low",
      likelyFiles: [],
    };
    expect(subtask.acceptanceCriteria).toBeUndefined();
  });
});
