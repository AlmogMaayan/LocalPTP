import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { detectGitRoot } from "../../src/utils/gitRoot.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-git-"));
  // Resolve realpath: on macOS/Windows tmp may be a symlink and git reports the real path.
  tmp = await fs.realpath(tmp);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("detectGitRoot", () => {
  it("reports not-a-repo for a non-git directory", async () => {
    const result = await detectGitRoot(tmp);
    expect(result.isRepo).toBe(false);
    expect(result.root).toBeUndefined();
  });

  it("reports the root for a git repository", async () => {
    await simpleGit(tmp).init();
    const result = await detectGitRoot(tmp);
    expect(result.isRepo).toBe(true);
    expect(result.root).toBeDefined();
    expect(await fs.realpath(result.root!)).toBe(tmp);
  });
});
