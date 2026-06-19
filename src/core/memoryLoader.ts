/**
 * Memory loader (HLD-SRD §3.4, §3.7).
 *
 * Reads the top-level `/ai/*.md` files into a `name → content` map for the
 * Context Builder. Subdirectories (`tasks/`, `sessions/`) and non-markdown
 * files are ignored. A missing `/ai` dir yields an empty map (no crash).
 */
import { promises as fs } from "node:fs";
import { layout } from "../utils/paths.js";

export interface MemoryFiles {
  [name: string]: string;
}

export async function loadMemoryFiles(root: string): Promise<MemoryFiles> {
  const l = layout(root);
  const out: MemoryFiles = {};

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(l.aiDir, { withFileTypes: true });
  } catch {
    // Missing /ai dir (or unreadable) — degrade to an empty memory map.
    return out;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    try {
      out[entry.name] = await fs.readFile(l.memoryFile(entry.name), "utf8");
    } catch {
      // A file that vanished mid-read is simply omitted.
    }
  }

  return out;
}
