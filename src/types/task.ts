/**
 * Task types (HLD-SRD §3.5).
 *
 * A `Task` is the parsed view of a `/ai/tasks/*.md` file: a title, lifecycle
 * status, the free-form goal, and an ordered list of `step-N` subtasks. The
 * `raw` markdown is retained so the Task Manager can rewrite only the
 * `## Subtasks` block without losing other user content.
 */

export type TaskStatus = "active" | "done" | "blocked";
export type SubtaskStatus = "pending" | "active" | "done" | "blocked";
export type Risk = "low" | "medium" | "high";

export interface Subtask {
  /** Positional id, normalized to `step-N` (1-based) by the planner. */
  id: string;
  title: string;
  description: string;
  status: SubtaskStatus;
  risk: Risk;
  likelyFiles: string[];
  acceptanceCriteria?: string[];
}

export interface Task {
  /** Absolute path of the task file on disk. */
  path: string;
  title: string;
  status: TaskStatus;
  goal: string;
  subtasks: Subtask[];
  /** The original markdown, retained verbatim. */
  raw: string;
}
