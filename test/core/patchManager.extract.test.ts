/**
 * Patch Manager — unified diff extraction (task 2.1).
 */
import { describe, it, expect } from "vitest";
import { extractUnifiedDiff } from "../../src/core/patchManager.js";

const VALID_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index 0000000..1111111 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,1 @@
-const x = 1;
+const x = 2;
`;

describe("extractUnifiedDiff (2.1)", () => {
  it("returns the diff text for a bare valid diff", () => {
    const out = extractUnifiedDiff(VALID_DIFF);
    expect(out).not.toBeNull();
    expect(out).toContain("diff --git a/src/foo.ts b/src/foo.ts");
    expect(out).toContain("@@ -1,1 +1,1 @@");
  });

  it("strips a ```diff fenced block", () => {
    const raw = "Here is the patch:\n```diff\n" + VALID_DIFF + "```\n";
    const out = extractUnifiedDiff(raw);
    expect(out).not.toBeNull();
    expect(out).toContain("diff --git a/src/foo.ts b/src/foo.ts");
    // The fence markers must not leak into the diff body.
    expect(out).not.toContain("```");
  });

  it("strips surrounding prose (text before and after the diff)", () => {
    const raw =
      "Sure, I'll update that.\n\n" +
      VALID_DIFF +
      "\nLet me know if you need anything else.\n";
    const out = extractUnifiedDiff(raw);
    expect(out).not.toBeNull();
    expect(out).toContain("--- a/src/foo.ts");
    expect(out).toContain("+const x = 2;");
    expect(out).not.toContain("Sure, I'll update");
    expect(out).not.toContain("Let me know");
  });

  it("extracts a diff that starts at the --- / +++ headers (no diff --git line)", () => {
    const raw =
      "--- a/src/bar.ts\n+++ b/src/bar.ts\n@@ -1 +1 @@\n-a\n+b\n";
    const out = extractUnifiedDiff(raw);
    expect(out).not.toBeNull();
    expect(out).toContain("--- a/src/bar.ts");
  });

  it("returns null for empty / whitespace-only output", () => {
    expect(extractUnifiedDiff("")).toBeNull();
    expect(extractUnifiedDiff("   \n  \n")).toBeNull();
  });

  it("returns null for a needs_context JSON response", () => {
    const raw = JSON.stringify({
      status: "needs_context",
      files: ["src/x.ts"],
      reason: "need to see x",
    });
    expect(extractUnifiedDiff(raw)).toBeNull();
  });

  it("returns null for plain prose with no diff", () => {
    expect(extractUnifiedDiff("I cannot do this without more info.")).toBeNull();
  });
});
