/**
 * Context package + tolerant task/session types (HLD-SRD §9, §3.7).
 *
 * `ContextPackage` is the role-specific output of the Context Builder. The
 * `ActiveTask` / `ActiveSession` shapes are intentionally tolerant and
 * forward-compatible with the 0001_04 Task/Session Manager: every field is
 * optional, parsing never throws, and unknown structure degrades gracefully.
 */
import { z } from "zod";
import type { AgentRole } from "./model.js";

// ---------------------------------------------------------------------------
// ContextPackage (HLD-SRD §9)
// ---------------------------------------------------------------------------

const agentRoleSchema = z.enum([
  "planner",
  "retriever",
  "coder",
  "reviewer",
  "test-fixer",
  "summarizer",
]);

export const contextPackageSchema = z.object({
  role: agentRoleSchema,
  systemPrompt: z.string(),
  userPrompt: z.string(),
  includedMemoryFiles: z.array(z.string()),
  includedSourceFiles: z.array(z.string()),
  includedTestFiles: z.array(z.string()),
  estimatedTokens: z.number().int(),
  warnings: z.array(z.string()),
});

export interface ContextPackage {
  role: AgentRole;
  systemPrompt: string;
  userPrompt: string;
  includedMemoryFiles: string[];
  includedSourceFiles: string[];
  includedTestFiles: string[];
  estimatedTokens: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Tolerant active task / session (forward-compatible with 0001_04)
// ---------------------------------------------------------------------------

export interface ActiveSubtask {
  /** The subtask description line (without the checkbox prefix). */
  text: string;
  /** True when the markdown checkbox is checked (`- [x]`). */
  done: boolean;
  /** Files the subtask is likely to touch (from a `likelyFiles:` line). */
  likelyFiles?: string[];
}

export interface ActiveTask {
  goal?: string;
  subtasks?: ActiveSubtask[];
  /** The session/task `Next Step`, if present. */
  nextStep?: string;
  /** The original markdown, retained verbatim. */
  raw: string;
}

export interface ActiveSession {
  currentState?: string;
  nextStep?: string;
  raw: string;
}

/**
 * Extract the body of a markdown section by heading title (case-insensitive),
 * stopping at the next heading of the same-or-higher level. Returns the trimmed
 * body, or undefined when the heading is absent or its body is empty.
 */
function sectionBody(md: string, title: string): string | undefined {
  const lines = md.split(/\r?\n/);
  const titleLc = title.toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(lines[i]);
    if (m && m[2].toLowerCase() === titleLc) {
      start = i + 1;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return undefined;
  const collected: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const m = /^(#{1,6})\s+/.exec(lines[i]);
    if (m && m[1].length <= level) break;
    collected.push(lines[i]);
  }
  const body = collected.join("\n").trim();
  return body.length > 0 ? body : undefined;
}

function parseLikelyFiles(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parse the `## Subtasks` section into checkbox list items. Each `- [ ]` /
 * `- [x]` line starts a subtask; a following indented `likelyFiles:` line (or a
 * `likelyFiles:` token on the same line) attaches its files. Tolerant: no
 * checkboxes → no subtasks.
 */
function parseSubtasks(md: string): ActiveSubtask[] | undefined {
  const body = sectionBody(md, "Subtasks");
  if (body === undefined) return undefined;
  const lines = body.split(/\r?\n/);
  const subtasks: ActiveSubtask[] = [];
  let current: ActiveSubtask | undefined;
  const checkboxRe = /^\s*[-*]\s+\[( |x|X)\]\s*(.*)$/;
  const likelyRe = /likelyFiles\s*:\s*(.*)$/i;
  for (const line of lines) {
    const cb = checkboxRe.exec(line);
    if (cb) {
      const done = cb[1].toLowerCase() === "x";
      let text = cb[2].trim();
      const inlineLikely = likelyRe.exec(text);
      const subtask: ActiveSubtask = { text, done };
      if (inlineLikely) {
        // `- [ ] foo  likelyFiles: a.ts` — strip the trailing token from text.
        text = text.slice(0, inlineLikely.index).trim();
        subtask.text = text;
        subtask.likelyFiles = parseLikelyFiles(inlineLikely[1]);
      }
      subtasks.push(subtask);
      current = subtask;
      continue;
    }
    const likely = likelyRe.exec(line);
    if (likely && current && current.likelyFiles === undefined) {
      current.likelyFiles = parseLikelyFiles(likely[1]);
    }
  }
  return subtasks.length > 0 ? subtasks : undefined;
}

/** Parse a 0001_04-shaped task markdown string. Never throws. */
export function parseActiveTask(md: string): ActiveTask {
  const task: ActiveTask = { raw: md };
  const goal = sectionBody(md, "Goal");
  if (goal !== undefined) task.goal = goal;
  const subtasks = parseSubtasks(md);
  if (subtasks !== undefined) task.subtasks = subtasks;
  const nextStep = sectionBody(md, "Next Step");
  if (nextStep !== undefined) task.nextStep = nextStep;
  return task;
}

/** Parse a session markdown string tolerantly. Never throws. */
export function parseActiveSession(md: string): ActiveSession {
  const session: ActiveSession = { raw: md };
  const currentState = sectionBody(md, "Current State");
  if (currentState !== undefined) session.currentState = currentState;
  const nextStep = sectionBody(md, "Next Step");
  if (nextStep !== undefined) session.nextStep = nextStep;
  return session;
}

/**
 * Resolve the "current" subtask: the first unchecked subtask in document order,
 * else the first subtask, else undefined when there are no subtasks.
 */
export function firstIncompleteSubtask(
  task: ActiveTask,
): ActiveSubtask | undefined {
  const subs = task.subtasks;
  if (!subs || subs.length === 0) return undefined;
  return subs.find((s) => !s.done) ?? subs[0];
}
