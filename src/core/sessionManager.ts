/**
 * Session Manager (HLD-SRD §3.6).
 *
 * Creates `/ai/sessions/YYYY-MM-DD_HHMM_slug_session.md` files paired to a task,
 * applies section-scoped updates (Current State / Next Step / Risks / Decisions),
 * loads a session back into a typed `Session`, and lists sessions newest-first
 * with a Next-Step preview. Section edits preserve content elsewhere.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureDir } from "../utils/fs.js";
import type { Session } from "../types/session.js";
import type { Task, TaskStatus } from "../types/task.js";

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeStamp(d: Date): string {
  return `${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function fullStamp(d: Date): string {
  return `${dateStamp(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Section helpers (level-aware, shared shape with taskManager)
// ---------------------------------------------------------------------------

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
    return `${md}${sep}\n## ${heading}\n${newBody}\n`;
  }
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
  return [...before, headingLine, newBody, ...after].join("\n");
}

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
// Field parsing
// ---------------------------------------------------------------------------

function parseTaskRef(md: string): string {
  const m = /^Task:\s*(.*?)\s*$/m.exec(md);
  return m?.[1] ?? "";
}

function parseStatus(md: string): TaskStatus {
  const m = /^Status:\s*(active|done|blocked)\s*$/im.exec(md);
  return (m?.[1]?.toLowerCase() as TaskStatus) ?? "active";
}

function parseTitle(md: string): string {
  const m = /^#\s+Session:\s*(.*?)\s*$/m.exec(md);
  return m?.[1] ?? "";
}

// ---------------------------------------------------------------------------
// Slug from task path
// ---------------------------------------------------------------------------

/** Strip the `YYYY-MM-DD_HHMM_` prefix and `.md` suffix from a task basename. */
function slugFromTaskPath(taskPath: string): string {
  const base = path.basename(taskPath).replace(/\.md$/i, "");
  const m = /^\d{4}-\d{2}-\d{2}_\d{4}_(.*)$/.exec(base);
  return m?.[1] ?? base;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CreateSessionOptions {
  now?: Date;
}

function renderSessionFile(task: Task, now: Date): string {
  const stamp = fullStamp(now);
  return [
    `# Session: ${task.title}`,
    "",
    `Created: ${stamp}`,
    `Updated: ${stamp}`,
    `Task: ${task.path}`,
    "Status: active",
    "",
    "## Objective",
    task.goal,
    "",
    "## Current State",
    "Not started.",
    "",
    "## Files Inspected",
    "| File | Reason | Findings |",
    "|---|---|---|",
    "",
    "## Changes Made",
    "| File | Change |",
    "|---|---|",
    "",
    "## Decisions",
    "",
    "## Risks / Not Verified",
    "",
    "## Tests",
    "- Not run yet",
    "",
    "## Next Step",
    "Run `localcoder plan` to decompose the task.",
    "",
  ].join("\n");
}

/** Build a typed Session from a markdown string. */
export function parseSessionString(filePath: string, md: string): Session {
  return {
    path: filePath,
    taskPath: parseTaskRef(md),
    status: parseStatus(md),
    objective: sectionBody(md, "Objective") ?? "",
    currentState: sectionBody(md, "Current State") ?? "",
    nextStep: sectionBody(md, "Next Step") ?? "",
    raw: md,
  };
}

/**
 * Create a session file for `task` under `sessionsDir`. Never overwrites: a
 * filename collision appends `-2`, `-3`, …
 */
export async function createSession(
  sessionsDir: string,
  task: Task,
  opts: CreateSessionOptions = {},
): Promise<Session> {
  const now = opts.now ?? new Date();
  await ensureDir(sessionsDir);
  const slug = slugFromTaskPath(task.path);
  const base = `${dateStamp(now)}_${timeStamp(now)}_${slug}_session`;
  const content = renderSessionFile(task, now);

  let attempt = 0;
  for (;;) {
    const name = attempt === 0 ? `${base}.md` : `${base}-${attempt + 1}.md`;
    const full = path.join(sessionsDir, name);
    try {
      await fs.writeFile(full, content, { encoding: "utf8", flag: "wx" });
      return parseSessionString(full, content);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
}

export interface SessionPatch {
  status?: TaskStatus;
  currentState?: string;
  nextStep?: string;
  /** Lines written into `## Risks / Not Verified`. */
  risks?: string[];
  /** Lines appended to `## Decisions`. */
  decisions?: string[];
  objective?: string;
}

function asBullets(items: string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

/**
 * Apply a section-scoped patch to a session and persist it. `risks` overwrites
 * the Risks section; `decisions` is appended to the Decisions section, keeping
 * any prior decisions. The `Updated:` line is refreshed.
 */
export async function updateSession(
  session: Session,
  patch: SessionPatch,
  opts: CreateSessionOptions = {},
): Promise<Session> {
  const now = opts.now ?? new Date();
  let raw = session.raw;

  if (patch.objective !== undefined) {
    raw = replaceSection(raw, "Objective", `\n${patch.objective}\n`);
  }
  if (patch.currentState !== undefined) {
    raw = replaceSection(raw, "Current State", `\n${patch.currentState}\n`);
  }
  if (patch.nextStep !== undefined) {
    raw = replaceSection(raw, "Next Step", `\n${patch.nextStep}\n`);
  }
  if (patch.risks !== undefined) {
    const body = patch.risks.length > 0 ? `\n${asBullets(patch.risks)}\n` : "\n";
    raw = replaceSection(raw, "Risks / Not Verified", body);
  }
  if (patch.decisions !== undefined && patch.decisions.length > 0) {
    const existing = sectionBody(raw, "Decisions");
    const merged = existing
      ? `${existing}\n${asBullets(patch.decisions)}`
      : asBullets(patch.decisions);
    raw = replaceSection(raw, "Decisions", `\n${merged}\n`);
  }
  if (patch.status !== undefined) {
    raw = raw.replace(/^Status:\s*.*$/m, `Status: ${patch.status}`);
  }
  // Refresh the Updated: line.
  raw = raw.replace(/^Updated:\s*.*$/m, `Updated: ${fullStamp(now)}`);

  await fs.writeFile(session.path, raw, "utf8");
  return parseSessionString(session.path, raw);
}

/** Read + parse a session from disk. */
export async function loadSession(filePath: string): Promise<Session> {
  const md = await fs.readFile(filePath, "utf8");
  return parseSessionString(filePath, md);
}

/**
 * List sessions newest-first (by mtime; name tiebreak). Each entry is a parsed
 * Session carrying status + Next-Step preview. A missing dir → empty array.
 */
export async function listSessions(sessionsDir: string): Promise<Session[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const items: { session: Session; mtimeMs: number; name: string }[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const full = path.join(sessionsDir, entry.name);
    try {
      const stat = await fs.stat(full);
      const md = await fs.readFile(full, "utf8");
      items.push({
        session: parseSessionString(full, md),
        mtimeMs: stat.mtimeMs,
        name: entry.name,
      });
    } catch {
      // Skip unreadable entries.
    }
  }
  items.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return b.name.localeCompare(a.name);
  });
  return items.map((i) => i.session);
}
