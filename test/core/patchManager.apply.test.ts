/**
 * Patch Manager — apply / savePatch / assertWorkingTreeSafe (tasks 4.1-4.6).
 *
 * Real temp git repos via the tempRepo helper. Offline; never an LM Studio.
 */
import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  apply,
  savePatch,
  assertWorkingTreeSafe,
  parsePatch,
  WorkingTreeUnsafeError,
  PatchApplyError,
} from "../../src/core/patchManager.js";
import {
  makeTempRepo,
  makeTempDir,
  buildModifyDiff,
  buildAddDiff,
} from "../helpers/tempRepo.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe("apply — git repo (4.2)", () => {
  it("runs --check then git apply; base content matches the diff result", async () => {
    const repo = await makeTempRepo({ "base.txt": "line one\n" });
    cleanups.push(repo.cleanup);
    const diff = buildModifyDiff("base.txt", "line one", "line two");
    await apply(parsePatch(diff), repo.root);
    const after = await fs.readFile(path.join(repo.root, "base.txt"), "utf8");
    expect(after).toBe("line two\n");
  });
});

describe("apply — non-applying diff (4.3)", () => {
  it("--check rejects and the working tree is unchanged", async () => {
    const repo = await makeTempRepo({ "base.txt": "line one\n" });
    cleanups.push(repo.cleanup);
    // Diff expects `WRONG` as the original line — will not apply.
    const diff = buildModifyDiff("base.txt", "WRONG", "line two");
    await expect(apply(parsePatch(diff), repo.root)).rejects.toBeInstanceOf(
      PatchApplyError,
    );
    const after = await fs.readFile(path.join(repo.root, "base.txt"), "utf8");
    expect(after).toBe("line one\n");
  });
});

describe("apply — non-git dir (4.4)", () => {
  it("new-file add applies via controlled write (no git --check)", async () => {
    const dir = await makeTempDir();
    cleanups.push(dir.cleanup);
    const diff = buildAddDiff("src/new.ts", "const a = 1;");
    await apply(parsePatch(diff), dir.root);
    const written = await fs.readFile(path.join(dir.root, "src/new.ts"), "utf8");
    expect(written).toBe("const a = 1;\n");
  });

  it("an existing-file modify in a non-git dir is refused (no rollback layer)", async () => {
    const dir = await makeTempDir({ "base.txt": "line one\n" });
    cleanups.push(dir.cleanup);
    const diff = buildModifyDiff("base.txt", "line one", "line two");
    await expect(apply(parsePatch(diff), dir.root)).rejects.toBeInstanceOf(
      PatchApplyError,
    );
    const after = await fs.readFile(path.join(dir.root, "base.txt"), "utf8");
    expect(after).toBe("line one\n");
  });
});

describe("savePatch (4.5)", () => {
  it("writes .ai-orchestrator/patches/<ts>_<step-id>.patch", async () => {
    const dir = await makeTempDir();
    cleanups.push(dir.cleanup);
    const orchestratorDir = path.join(dir.root, ".ai-orchestrator");
    const diff = buildAddDiff("src/new.ts", "const a = 1;");
    const saved = await savePatch(diff, "step-1", orchestratorDir, {
      now: new Date("2026-06-18T09:30:00"),
    });
    expect(saved).toMatch(/[\\/]\.ai-orchestrator[\\/]patches[\\/]/);
    expect(path.basename(saved)).toMatch(/^2026-06-18_0930_step-1\.patch$/);
    const content = await fs.readFile(saved, "utf8");
    expect(content).toBe(diff);
  });
});

describe("assertWorkingTreeSafe (4.6)", () => {
  it("refuses a repo mid-merge", async () => {
    const repo = await makeTempRepo({ "base.txt": "line one\n" });
    cleanups.push(repo.cleanup);
    // Simulate a merge in progress by creating .git/MERGE_HEAD.
    const head = (await repo.git.revparse(["HEAD"])).trim();
    await fs.writeFile(path.join(repo.root, ".git", "MERGE_HEAD"), head + "\n", "utf8");
    await expect(assertWorkingTreeSafe(repo.root)).rejects.toBeInstanceOf(
      WorkingTreeUnsafeError,
    );
  });

  it("allows a clean (or merely dirty) repo not mid-merge", async () => {
    const repo = await makeTempRepo({ "base.txt": "line one\n" });
    cleanups.push(repo.cleanup);
    // Unrelated dirty file is tolerated.
    await fs.writeFile(path.join(repo.root, "dirty.txt"), "scratch\n", "utf8");
    await expect(assertWorkingTreeSafe(repo.root)).resolves.toBeUndefined();
  });

  it("is a no-op for a non-git dir (no merge state possible)", async () => {
    const dir = await makeTempDir();
    cleanups.push(dir.cleanup);
    await expect(assertWorkingTreeSafe(dir.root)).resolves.toBeUndefined();
  });
});
