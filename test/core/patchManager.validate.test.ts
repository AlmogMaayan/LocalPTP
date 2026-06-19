/**
 * Patch Manager — validate(plan, config, root) (task 2.3).
 *
 * Real temp dir so existence + symlink-escape checks hit the filesystem.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsePatch, validate, PatchValidationError } from "../../src/core/patchManager.js";
import { appConfigSchema } from "../../src/types/config.js";

let root: string;
let outside: string;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "lc-pm-val-")));
  outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "lc-pm-out-")));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

const config = appConfigSchema.parse({});

function modifyDiff(p: string): string {
  return `diff --git a/${p} b/${p}
index 1111111..2222222 100644
--- a/${p}
+++ b/${p}
@@ -1,1 +1,1 @@
-const x = 1;
+const x = 2;
`;
}

function addDiff(p: string): string {
  return `diff --git a/${p} b/${p}
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/${p}
@@ -0,0 +1,1 @@
+const a = 1;
`;
}

function deleteDiff(p: string): string {
  return `diff --git a/${p} b/${p}
deleted file mode 100644
index 1111111..0000000
--- a/${p}
+++ /dev/null
@@ -1,1 +0,0 @@
-const x = 1;
`;
}

describe("validate (2.3)", () => {
  it("accepts a modify whose target exists", async () => {
    await fs.writeFile(path.join(root, "exists.ts"), "const x = 1;\n");
    const plan = parsePatch(modifyDiff("exists.ts"));
    await expect(validate(plan, config, root)).resolves.toBeUndefined();
  });

  it("rejects a modify whose target is missing", async () => {
    const plan = parsePatch(modifyDiff("missing.ts"));
    await expect(validate(plan, config, root)).rejects.toBeInstanceOf(PatchValidationError);
  });

  it("rejects a delete whose target is missing", async () => {
    const plan = parsePatch(deleteDiff("missing.ts"));
    await expect(validate(plan, config, root)).rejects.toBeInstanceOf(PatchValidationError);
  });

  it("rejects an add that targets an existing file (never overwrite)", async () => {
    await fs.writeFile(path.join(root, "exists.ts"), "const x = 1;\n");
    const plan = parsePatch(addDiff("exists.ts"));
    await expect(validate(plan, config, root)).rejects.toBeInstanceOf(PatchValidationError);
  });

  it("accepts an add whose target is absent", async () => {
    const plan = parsePatch(addDiff("brand-new.ts"));
    await expect(validate(plan, config, root)).resolves.toBeUndefined();
  });

  it("rejects an ignored file", async () => {
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "p.ts"), "x");
    const plan = parsePatch(modifyDiff("node_modules/p.ts"));
    await expect(validate(plan, config, root)).rejects.toBeInstanceOf(PatchValidationError);
  });

  it("rejects a ../ root-escaping path", async () => {
    const plan = parsePatch(modifyDiff("../escape.ts"));
    await expect(validate(plan, config, root)).rejects.toBeInstanceOf(PatchValidationError);
  });

  it("rejects an absolute path", async () => {
    const abs = path.join(outside, "abs.ts").replace(/\\/g, "/");
    // Build a diff whose path is absolute.
    const plan = parsePatch(modifyDiff(abs));
    await expect(validate(plan, config, root)).rejects.toBeInstanceOf(PatchValidationError);
  });

  it("rejects a path resolving outside root through a symlinked directory", async () => {
    // Create a symlink `link` inside root pointing to a directory outside root,
    // and a real target file there. A path-resolve-only check would see
    // `root/link/secret.ts` as inside root; realpath catches the escape.
    await fs.writeFile(path.join(outside, "secret.ts"), "const s = 1;\n");
    try {
      await fs.symlink(outside, path.join(root, "link"), "dir");
    } catch {
      // Some CI lacks symlink privilege; skip rather than false-fail.
      return;
    }
    const plan = parsePatch(modifyDiff("link/secret.ts"));
    await expect(validate(plan, config, root)).rejects.toBeInstanceOf(PatchValidationError);
  });
});
