/**
 * Session type (HLD-SRD §3.6).
 *
 * A `Session` is the parsed view of a `/ai/sessions/*.md` file. It references
 * its task (`taskPath`) and tracks the working state the user resumes from.
 * `raw` is retained so the Session Manager can rewrite individual sections
 * without losing other content.
 */
import type { TaskStatus } from "./task.js";

export interface Session {
  /** Absolute path of the session file on disk. */
  path: string;
  /** Path of the task this session is working on. */
  taskPath: string;
  status: TaskStatus;
  objective: string;
  currentState: string;
  nextStep: string;
  /** The original markdown, retained verbatim. */
  raw: string;
}
