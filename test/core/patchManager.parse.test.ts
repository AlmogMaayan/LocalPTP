/**
 * Patch Manager — parse / classify (task 2.2).
 */
import { describe, it, expect } from "vitest";
import { parsePatch } from "../../src/core/patchManager.js";

const ADD = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const a = 1;
+export const b = 2;
`;

const MODIFY = `diff --git a/src/old.ts b/src/old.ts
index 1111111..2222222 100644
--- a/src/old.ts
+++ b/src/old.ts
@@ -1,1 +1,1 @@
-const x = 1;
+const x = 2;
`;

const DELETE = `diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 1111111..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-const x = 1;
`;

const BINARY = `diff --git a/img.png b/img.png
new file mode 100644
index 0000000..1111111
GIT binary patch
literal 8
LcmZQ7=mp&x01
`;

describe("parsePatch (2.2)", () => {
  it("classifies an add and enumerates the touched path", () => {
    const plan = parsePatch(ADD);
    expect(plan.adds).toEqual(["src/new.ts"]);
    expect(plan.modifies).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.touchedFiles).toEqual(["src/new.ts"]);
    expect(plan.isBinary).toBe(false);
  });

  it("classifies a modify", () => {
    const plan = parsePatch(MODIFY);
    expect(plan.modifies).toEqual(["src/old.ts"]);
    expect(plan.adds).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.touchedFiles).toEqual(["src/old.ts"]);
  });

  it("classifies a delete", () => {
    const plan = parsePatch(DELETE);
    expect(plan.deletes).toEqual(["src/gone.ts"]);
    expect(plan.adds).toEqual([]);
    expect(plan.modifies).toEqual([]);
    expect(plan.touchedFiles).toEqual(["src/gone.ts"]);
  });

  it("flags a binary patch", () => {
    const plan = parsePatch(BINARY);
    expect(plan.isBinary).toBe(true);
    expect(plan.touchedFiles).toEqual(["img.png"]);
  });

  it("enumerates all touched paths across multiple file sections", () => {
    const multi = ADD + MODIFY + DELETE;
    const plan = parsePatch(multi);
    expect(new Set(plan.touchedFiles)).toEqual(
      new Set(["src/new.ts", "src/old.ts", "src/gone.ts"]),
    );
    expect(plan.adds).toEqual(["src/new.ts"]);
    expect(plan.modifies).toEqual(["src/old.ts"]);
    expect(plan.deletes).toEqual(["src/gone.ts"]);
  });
});
