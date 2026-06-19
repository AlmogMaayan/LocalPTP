/**
 * Task Manager (HLD-SRD §3.5).
 *
 * Creates `/ai/tasks/YYYY-MM-DD_HHMM_slug.md` files, parses them into a typed
 * `Task`, and rewrites ONLY the `## Subtasks` block on edit (heading-section
 * discipline) so user content elsewhere is preserved. The model's free-form
 * task text is stored verbatim in `## Goal`; the filename slug is sanitized to
 * ASCII-kebab.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureDir } from "../utils/fs.js";
import type { Task, Subtask, TaskStatus, SubtaskStatus, Risk } from "../types/task.js";

const SUBTASKS_HEADING = "Subtasks";

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

/**
 * Slugify free task text: drop diacritics, lower-case, keep [a-z0-9], collapse
 * runs to single hyphens, take the first ~6 words. Empty result → `task`.
 */
export function slugify(text: string): string {
  const ascii = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase();
  const words = ascii
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0)
    .slice(0, 6);
  const slug = words.join("-");
  return slug.length > 0 ? slug : "task";
}

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD` */
function dateStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `HHMM` */
function timeStamp(d: Date): string {
  return `${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** `YYYY-MM-DD HH:MM` for the `Created:` line. */
function createdStamp(d: Date): string {
  return `${dateStamp(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Section helpers (heading-delimited, level-aware)
// ---------------------------------------------------------------------------

/**
 * Replace the body of a `## <heading>` section with `newBody`, preserving the
 * heading line and everything outside the section. If the heading is absent,
 * append a fresh section. Section ends at the next heading of same-or-higher
 * level.
 */
function replaceSection(md: string, heading: string, newBody: string): string {
  const lines = md.split(/\r?\n/);
  const headingLc = heading.toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(lines[i]);
    if (m && m[2].toLowerCase() === headingLc) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) {
    const sep = md.length > 0 && !md.endsWith("\n") ? "\n" : "";
    return `${md}${sep}\n${"#".repeat(2)} ${heading}\n${newBody}\n`;
  }
  // Find the end of the section body.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s+/.exec(lines[i]);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  const headingLine = lines[start];
  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const rebuilt = [...before, headingLine, newBody, ...after];
  return rebuilt.join("\n");
}

/** Trimmed body of a `## <heading>` section, or undefined. */
function sectionBody(md: string, heading: string): string | undefined {
  const lines = md.split(/\r?\n/);
  const headingLc = heading.toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(lines[i]);
    if (m && m[2].toLowerCase() === headingLc) {
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

// ---------------------------------------------------------------------------
// Subtask serialization
// ---------------------------------------------------------------------------

const RISK_VALUES: Risk[] = ["low", "medium", "high"];

function normalizeRisk(raw: string | undefined): Risk {
  const v = (raw ?? "").trim().toLowerCase();
  return (RISK_VALUES as string[]).includes(v) ? (v as Risk) : "medium";
}

function statusToCheckbox(status: SubtaskStatus): string {
  return status === "done" ? "x" : " ";
}

/**
 * Render the subtasks list. Each subtask is a checkbox line carrying its id,
 * title and risk; an optional indented `likelyFiles:` line follows. The
 * checkbox form keeps the tolerant 0001_03 parser working.
 */
function renderSubtasks(subtasks: Subtask[]): string {
  if (subtasks.length === 0) return "";
  const out: string[] = [];
  for (const s of subtasks) {
    const box = statusToCheckbox(s.status);
    out.push(`- [${box}] ${s.id}: ${s.title} (risk: ${s.risk})`);
    if (s.description.trim().length > 0) {
      out.push(`  description: ${s.description.trim()}`);
    }
    if (s.likelyFiles.length > 0) {
      out.push(`  likelyFiles: ${s.likelyFiles.join(", ")}`);
    }
    if (s.acceptanceCriteria && s.acceptanceCriteria.length > 0) {
      out.push(`  acceptanceCriteria: ${s.acceptanceCriteria.join("; ")}`);
    }
  }
  return out.join("\n");
}

function parseList(raw: string, sep: string): string[] {
  return raw
    .split(sep)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const CHECKBOX_RE = /^\s*[-*]\s+\[( |x|X)\]\s*(.*)$/;
const ATTR_RE = /^\s+([a-zA-Z]+)\s*:\s*(.*)$/;

/** Parse the `## Subtasks` block into typed Subtasks. */
function parseSubtasks(md: string): Subtask[] {
  const body = sectionBody(md, SUBTASKS_HEADING);
  if (body === undefined) return [];
  const lines = body.split(/\r?\n/);
  const subtasks: Subtask[] = [];
  let current: Subtask | undefined;
  let index = 0;
  for (const line of lines) {
    const cb = CHECKBOX_RE.exec(line);
    if (cb) {
      index += 1;
      const done = cb[1].toLowerCase() === "x";
      let rest = cb[2].trim();
      // Risk: trailing `(risk: low)`.
      let risk: Risk = "medium";
      const riskM = /\(risk:\s*([a-zA-Z]+)\s*\)\s*$/i.exec(rest);
      if (riskM) {
        risk = normalizeRisk(riskM[1]);
        rest = rest.slice(0, riskM.index).trim();
      }
      // Id prefix: `step-N:`.
      let id = `step-${index}`;
      let title = rest;
      const idM = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(rest);
      if (idM) {
        id = idM[1];
        title = idM[2].trim();
      }
      const status: SubtaskStatus = done ? "done" : "pending";
      current = {
        id,
        title,
        description: "",
        status,
        risk,
        likelyFiles: [],
      };
      subtasks.push(current);
      continue;
    }
    const attr = ATTR_RE.exec(line);
    if (attr && current) {
      const key = attr[1].toLowerCase();
      const value = attr[2].trim();
      if (key === "likelyfiles") current.likelyFiles = parseList(value, ",");
      else if (key === "acceptancecriteria")
        current.acceptanceCriteria = parseList(value, ";");
      else if (key === "description") current.description = value;
    }
  }
  return subtasks;
}

// ---------------------------------------------------------------------------
// Status / title parsing
// ---------------------------------------------------------------------------

function parseStatus(md: string): TaskStatus {
  const m = /^Status:\s*(active|done|blocked)\s*$/im.exec(md);
  return (m?.[1]?.toLowerCase() as TaskStatus) ?? "active";
}

function parseTitle(md: string): string {
  const m = /^#\s+Task:\s*(.*?)\s*$/m.exec(md);
  return m?.[1] ?? "";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CreateTaskOptions {
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

/** Build the §3.5 markdown for a new task. */
function renderTaskFile(text: string, now: Date): string {
  return [
    `# Task: ${text}`,
    "",
    `Created: ${createdStamp(now)}`,
    "Status: active",
    "",
    "## Goal",
    text,
    "",
    "## Background",
    "",
    "## Requirements",
    "",
    "## Non-goals",
    "",
    "## Acceptance Criteria",
    "",
    "## Subtasks",
    "",
    "## Tests",
    "- npm run typecheck",
    "- npm test",
    "",
  ].join("\n");
}

/**
 * Create a new task file under `tasksDir`. Never overwrites: on a filename
 * collision (same timestamp+slug) appends `-2`, `-3`, … Returns the parsed Task.
 */
export async function createTask(
  tasksDir: string,
  text: string,
  opts: CreateTaskOptions = {},
): Promise<Task> {
  const now = opts.now ?? new Date();
  await ensureDir(tasksDir);
  const base = `${dateStamp(now)}_${timeStamp(now)}_${slugify(text)}`;
  const content = renderTaskFile(text, now);

  let attempt = 0;
  // First try the bare name, then -2, -3, … using O_EXCL to avoid races/overwrite.
  for (;;) {
    const name = attempt === 0 ? `${base}.md` : `${base}-${attempt + 1}.md`;
    const full = path.join(tasksDir, name);
    try {
      await fs.writeFile(full, content, { encoding: "utf8", flag: "wx" });
      return parseTaskString(full, content);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
}

/** Parse a task markdown string into a typed Task. */
export function parseTaskString(filePath: string, md: string): Task {
  return {
    path: filePath,
    title: parseTitle(md),
    status: parseStatus(md),
    goal: sectionBody(md, "Goal") ?? "",
    subtasks: parseSubtasks(md),
    raw: md,
  };
}

/** Read + parse a task file from disk. */
export async function parseTask(filePath: string): Promise<Task> {
  const md = await fs.readFile(filePath, "utf8");
  return parseTaskString(filePath, md);
}

/**
 * Return a Task whose `## Subtasks` block (in `raw`) is rewritten to `subtasks`,
 * preserving all other content. Pure: callers persist via `serializeTask`.
 */
export function setSubtasks(task: Task, subtasks: Subtask[]): Task {
  const body = renderSubtasks(subtasks);
  const sectionContent = body.length > 0 ? `\n${body}\n` : "\n";
  const raw = replaceSection(task.raw, SUBTASKS_HEADING, sectionContent);
  return { ...task, subtasks, raw };
}

/** The markdown to persist for a Task (its `raw`). */
export function serializeTask(task: Task): string {
  return task.raw;
}
