/**
 * Memory Manager (HLD-SRD §3.4).
 *
 * `scaffold()` ensures the `/ai`, `/ai/tasks`, `/ai/sessions` and
 * `.ai-orchestrator` dirs exist, then writes each of the 14 starter templates
 * ONLY if absent (preserving user edits). Returns a created/preserved report.
 *
 * `updateMarkerSection(filePath, markerId, body)` — edit-preserving marker-
 * delimited section update for tool-owned regions (e.g. `<!-- BEGIN
 * localcoder:index -->`). Appends a fresh block when markers are absent.
 *
 * `appendMemoryEntry(filePath, sectionHeading, rawEntry)` — accumulating
 * append-only writer (0001_07). Adds a dated, length-capped entry under the
 * named `## ` section, preserving all existing content and de-duplicating an
 * identical same-day entry in the same section. Distinct from the marker-
 * section regeneration approach used by the indexer.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureDir, writeIfAbsent, readIfExists } from "../utils/fs.js";
import type { Layout } from "../utils/paths.js";
import { MEMORY_TEMPLATES } from "../templates/memory.js";

/**
 * Per-entry character cap for appended memory entries (design §3, assumption 3).
 * Content longer than this cap is truncated before writing.
 */
export const MAX_ENTRY_CHARS = 280;

export interface ScaffoldReport {
  created: string[];
  preserved: string[];
}

function dateStamp(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Replace or append a marker-delimited section in a file.
 *
 * Markers: `<!-- BEGIN localcoder:<markerId> -->` / `<!-- END localcoder:<markerId> -->`
 *
 * - If both markers exist: replaces the inner region with `\n${body}\n`, preserving
 *   all content outside.
 * - If markers are absent: appends a fresh BEGIN/body/END block.
 * - If duplicate BEGIN markers: replaces the first complete block, warns.
 * - If file doesn't exist: creates it with just the marker block.
 */
export async function updateMarkerSection(
  filePath: string,
  markerId: string,
  body: string,
): Promise<void> {
  const begin = `<!-- BEGIN localcoder:${markerId} -->`;
  const end = `<!-- END localcoder:${markerId} -->`;

  const existing = (await readIfExists(filePath)) ?? "";

  const beginIdx = existing.indexOf(begin);
  const endIdx = existing.indexOf(end, beginIdx >= 0 ? beginIdx : 0);

  let next: string;

  if (beginIdx >= 0 && endIdx >= 0) {
    // Check for duplicate BEGIN markers after the first END
    const secondBeginIdx = existing.indexOf(begin, beginIdx + 1);
    if (secondBeginIdx >= 0) {
      process.stderr.write(`warning: updateMarkerSection: duplicate BEGIN localcoder:${markerId} markers found in ${filePath}; replacing the first complete block.\n`);
    }

    // Replace the inner content between begin and end markers
    const before = existing.slice(0, beginIdx + begin.length);
    const after = existing.slice(endIdx);
    next = `${before}\n${body}\n${after}`;
  } else {
    // Append a fresh block
    const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    next = `${existing}${sep}\n${begin}\n${body}\n${end}\n`;
  }

  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, next, "utf8");
}

// ---------------------------------------------------------------------------
// appendMemoryEntry (accumulating append-only writer, 0001_07)
// ---------------------------------------------------------------------------

function todayStamp(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function titleFromFile(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  // Convert kebab-case to Title Case
  return base
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Append a dated, length-capped entry under `sectionHeading` in `filePath`.
 *
 * Algorithm:
 *   1. Read the file (or default to a title heading if absent).
 *   2. Build the entry line: `- YYYY-MM-DD — <truncated content>`.
 *   3. If the file already contains that exact line anywhere inside
 *      `## sectionHeading` → return (de-dupe same-day identical entry).
 *   4. If `## sectionHeading` exists: insert the entry at the END of that
 *      section (just before the next `## ` of same/lower level or EOF).
 *   5. If not: append a fresh `\n## sectionHeading\n<entry>\n` block.
 *   6. Write file — only the inserted line differs; all prior prose is intact.
 */
export async function appendMemoryEntry(
  filePath: string,
  sectionHeading: string,
  rawEntry: string,
): Promise<void> {
  const today = todayStamp();
  const truncated =
    rawEntry.length > MAX_ENTRY_CHARS
      ? rawEntry.slice(0, MAX_ENTRY_CHARS)
      : rawEntry;
  const entryLine = `- ${today} — ${truncated}`;

  // 1. Read or initialize the file body.
  let body = (await readIfExists(filePath)) ?? `# ${titleFromFile(filePath)}\n`;

  // 2. Check for de-duplication: is this exact entry already in the section?
  //    We find the section's content range first and check within it.
  const lines = body.split("\n");
  const headingPattern = /^(#{1,6})\s+(.*?)\s*$/;

  let sectionStart = -1;
  let sectionLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const m = headingPattern.exec(lines[i]);
    if (m && m[2] === sectionHeading) {
      sectionStart = i;
      sectionLevel = m[1].length;
      break;
    }
  }

  if (sectionStart >= 0) {
    // Find the end of the section.
    let sectionEnd = lines.length;
    for (let i = sectionStart + 1; i < lines.length; i++) {
      const m = headingPattern.exec(lines[i]);
      if (m && m[1].length <= sectionLevel) {
        sectionEnd = i;
        break;
      }
    }

    // Check for duplicate in this section.
    const sectionLines = lines.slice(sectionStart + 1, sectionEnd);
    if (sectionLines.includes(entryLine)) {
      return; // Already present — de-dupe.
    }

    // Insert the entry at the end of this section (before sectionEnd).
    // Find the last non-blank line in the section and insert after it.
    let insertAt = sectionEnd;
    // Insert before sectionEnd, but we need to add it in lines[] then rejoin.
    const before = lines.slice(0, insertAt);
    const after = lines.slice(insertAt);
    const merged = [...before, entryLine, ...after];
    body = merged.join("\n");
  } else {
    // Section does not exist — append it.
    const sep = body.length > 0 && !body.endsWith("\n") ? "\n" : "";
    body = `${body}${sep}\n## ${sectionHeading}\n${entryLine}\n`;
  }

  // Write the result.
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
}

export class MemoryManager {
  constructor(private readonly layout: Layout) {}

  async scaffold(): Promise<ScaffoldReport> {
    await ensureDir(this.layout.orchestratorDir);
    await ensureDir(this.layout.aiDir);
    await ensureDir(this.layout.tasksDir);
    await ensureDir(this.layout.sessionsDir);

    const stamp = dateStamp();
    const created: string[] = [];
    const preserved: string[] = [];

    for (const template of MEMORY_TEMPLATES) {
      const target = this.layout.memoryFile(template.name);
      const wasCreated = await writeIfAbsent(target, template.render(stamp));
      if (wasCreated) {
        created.push(template.name);
      } else {
        preserved.push(template.name);
      }
    }

    return { created, preserved };
  }
}
