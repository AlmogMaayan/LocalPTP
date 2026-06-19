/**
 * Active pointer (`.ai-orchestrator/active.json`).
 *
 * Records the active `{ taskPath, sessionPath }` pair so downstream commands
 * (`context`, `plan`, `step`, …) resolve the active work in O(1) without a
 * newest-file heuristic. Written atomically (temp file + rename). A pointer to
 * a deleted file is detected by `resolveActive` rather than crashing the caller.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureDir, readIfExists } from "../utils/fs.js";

export interface ActivePointer {
  taskPath: string;
  sessionPath: string;
}

const FILE_NAME = "active.json";

function pointerPath(orchestratorDir: string): string {
  return path.join(orchestratorDir, FILE_NAME);
}

/**
 * Write the pointer atomically: write a uniquely-named temp file in the same
 * directory, then rename over the target (rename is atomic on the same volume).
 */
export async function writeActive(
  orchestratorDir: string,
  pointer: ActivePointer,
): Promise<void> {
  await ensureDir(orchestratorDir);
  const target = pointerPath(orchestratorDir);
  const tmp = path.join(
    orchestratorDir,
    `.${FILE_NAME}.${process.pid}.${Date.now()}.tmp`,
  );
  const content = JSON.stringify(pointer, null, 2) + "\n";
  await fs.writeFile(tmp, content, "utf8");
  try {
    await fs.rename(tmp, target);
  } catch (err) {
    // Best-effort cleanup if the rename failed.
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** Read + parse the pointer, or undefined when absent/malformed. */
export async function readActive(
  orchestratorDir: string,
): Promise<ActivePointer | undefined> {
  const raw = await readIfExists(pointerPath(orchestratorDir));
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as ActivePointer).taskPath !== "string" ||
    typeof (parsed as ActivePointer).sessionPath !== "string"
  ) {
    return undefined;
  }
  const { taskPath, sessionPath } = parsed as ActivePointer;
  return { taskPath, sessionPath };
}

export type ActiveResolution =
  | { kind: "none" }
  | { kind: "missing-target"; pointer: ActivePointer; missing: string[] }
  | { kind: "ok"; pointer: ActivePointer };

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the active pointer, verifying both referenced files exist on disk.
 * - `none` — no pointer.
 * - `missing-target` — pointer exists but a referenced file is gone.
 * - `ok` — pointer and both files present.
 */
export async function resolveActive(
  orchestratorDir: string,
): Promise<ActiveResolution> {
  const pointer = await readActive(orchestratorDir);
  if (pointer === undefined) return { kind: "none" };
  const missing: string[] = [];
  if (!(await exists(pointer.taskPath))) missing.push(pointer.taskPath);
  if (!(await exists(pointer.sessionPath))) missing.push(pointer.sessionPath);
  if (missing.length > 0) return { kind: "missing-target", pointer, missing };
  return { kind: "ok", pointer };
}
