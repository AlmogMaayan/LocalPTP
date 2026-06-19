/**
 * Repo-root detection (HLD-SRD §3.1). Warn — never fail — when the directory is
 * not a Git repo; later Git-dependent safety features require `.git`, this slice
 * does not.
 */
import { simpleGit } from "simple-git";

export interface GitRootResult {
  isRepo: boolean;
  root?: string;
}

export async function detectGitRoot(cwd: string): Promise<GitRootResult> {
  const git = simpleGit(cwd);
  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return { isRepo: false };
    }
    const root = (await git.revparse(["--show-toplevel"])).trim();
    return { isRepo: true, root };
  } catch {
    return { isRepo: false };
  }
}
