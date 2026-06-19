/**
 * Test helper: create a real temp git repo and build diffs against it.
 *
 * Uses simple-git to `init` + commit a base file. NEVER touches the network or
 * a real LM Studio. `buildDiff` produces a minimal unified diff that `git apply`
 * accepts for a single-line modify of a tracked file.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";

export interface TempRepo {
  root: string;
  git: SimpleGit;
  cleanup(): Promise<void>;
}

/** Create a temp dir, `git init`, set identity, and commit `files`. */
export async function makeTempRepo(
  files: Record<string, string> = { "base.txt": "line one\n" },
): Promise<TempRepo> {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "lc-repo-")),
  );
  const git = simpleGit(root);
  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test");
  await git.addConfig("commit.gpgsign", "false");
  // Keep LF endings deterministic across platforms (Windows would otherwise
  // CRLF-convert on checkout/apply and break exact content assertions).
  await git.addConfig("core.autocrlf", "false");
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }
  await git.add(".");
  await git.commit("base");
  return {
    root,
    git,
    async cleanup() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

/** Create a plain (non-git) temp dir with optional seed files. */
export async function makeTempDir(
  files: Record<string, string> = {},
): Promise<{ root: string; cleanup(): Promise<void> }> {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "lc-dir-")),
  );
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }
  return {
    root,
    async cleanup() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * Build a single-line-modify unified diff replacing the full content of `rel`
 * (currently `from`) with `to`. Both are single lines (newline-terminated form
 * handled here). Produces a diff `git apply` accepts in the repo root.
 */
export function buildModifyDiff(rel: string, from: string, to: string): string {
  return [
    `diff --git a/${rel} b/${rel}`,
    `index 1111111..2222222 100644`,
    `--- a/${rel}`,
    `+++ b/${rel}`,
    `@@ -1,1 +1,1 @@`,
    `-${from}`,
    `+${to}`,
    ``,
  ].join("\n");
}

/** Build a new-file add diff for `rel` with a single line `content`. */
export function buildAddDiff(rel: string, content: string): string {
  return [
    `diff --git a/${rel} b/${rel}`,
    `new file mode 100644`,
    `index 0000000..2222222`,
    `--- /dev/null`,
    `+++ b/${rel}`,
    `@@ -0,0 +1,1 @@`,
    `+${content}`,
    ``,
  ].join("\n");
}
