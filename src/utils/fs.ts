/**
 * Filesystem helpers: idempotent dir creation, write-if-absent (no clobber),
 * read-if-exists, and a marker-guarded `.gitignore` stanza appender.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export const GITIGNORE_MARKER = "# localcoder";

const GITIGNORE_STANZA = `${GITIGNORE_MARKER}
.ai-orchestrator/logs/
.ai-orchestrator/context-packages/
`;

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Write `content` to `file` only if it does not already exist.
 * Returns true if the file was created, false if it was preserved.
 */
export async function writeIfAbsent(
  file: string,
  content: string,
): Promise<boolean> {
  await ensureDir(path.dirname(file));
  try {
    // wx fails if the path exists — atomic no-clobber.
    await fs.writeFile(file, content, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw err;
  }
}

export async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
}

/**
 * Append the localcoder `.gitignore` stanza unless its marker is already present.
 * Returns true if the stanza was appended, false if it was already there.
 */
export async function appendGitignoreStanza(
  gitignoreFile: string,
): Promise<boolean> {
  const existing = await readIfExists(gitignoreFile);
  if (existing !== undefined && existing.includes(GITIGNORE_MARKER)) {
    return false;
  }
  let next: string;
  if (existing === undefined || existing.length === 0) {
    next = GITIGNORE_STANZA;
  } else {
    const sep = existing.endsWith("\n") ? "\n" : "\n\n";
    next = existing + sep + GITIGNORE_STANZA;
  }
  await ensureDir(path.dirname(gitignoreFile));
  await fs.writeFile(gitignoreFile, next, "utf8");
  return true;
}
