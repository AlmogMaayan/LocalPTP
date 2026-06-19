/**
 * Safety Manager — evaluate(plan, config, root) pure decision (tasks 3.1-3.3).
 */
import { describe, it, expect } from "vitest";
import { evaluate } from "../../src/core/safetyManager.js";
import { appConfigSchema } from "../../src/types/config.js";
import type { PatchPlan } from "../../src/types/patch.js";

const ROOT = "/repo";
const config = appConfigSchema.parse({});

function plan(over: Partial<PatchPlan>): PatchPlan {
  return {
    touchedFiles: over.touchedFiles ?? [],
    adds: over.adds ?? [],
    modifies: over.modifies ?? [],
    deletes: over.deletes ?? [],
    isBinary: over.isBinary ?? false,
    diff: over.diff ?? "",
  };
}

describe("safetyManager.evaluate — refusals (3.1)", () => {
  it("refuses a binary patch", () => {
    const v = evaluate(plan({ touchedFiles: ["img.png"], isBinary: true }), config, ROOT);
    expect(v.decision).toBe("refuse");
    expect(v.reasons.join(" ")).toMatch(/binary/i);
  });

  it("refuses a path that escapes the root", () => {
    const v = evaluate(plan({ touchedFiles: ["../escape.ts"], modifies: ["../escape.ts"] }), config, ROOT);
    expect(v.decision).toBe("refuse");
    expect(v.reasons.join(" ")).toMatch(/escape|root/i);
  });

  it("refuses an ignored file", () => {
    const v = evaluate(plan({ touchedFiles: ["node_modules/x.ts"], modifies: ["node_modules/x.ts"] }), config, ROOT);
    expect(v.decision).toBe("refuse");
    expect(v.reasons.join(" ")).toMatch(/ignored|generated/i);
  });
});

describe("safetyManager.evaluate — changed-file cap (3.2)", () => {
  it("refuses when touched files exceed maxChangedFilesPerStep", () => {
    const cfg = appConfigSchema.parse({ safety: { maxChangedFilesPerStep: 2 } });
    const files = ["src/a.ts", "src/b.ts", "src/c.ts"];
    const v = evaluate(plan({ touchedFiles: files, modifies: files }), cfg, ROOT);
    expect(v.decision).toBe("refuse");
    expect(v.reasons.join(" ")).toMatch(/too many|changed files/i);
  });

  it("allows at exactly the limit", () => {
    const cfg = appConfigSchema.parse({ safety: { maxChangedFilesPerStep: 2 } });
    const files = ["src/a.ts", "src/b.ts"];
    const v = evaluate(plan({ touchedFiles: files, modifies: files }), cfg, ROOT);
    expect(v.decision).toBe("allow");
  });
});

describe("safetyManager.evaluate — confirmations (3.3)", () => {
  it("a clean non-risky modify is allowed with no confirmations", () => {
    const v = evaluate(plan({ touchedFiles: ["src/app.ts"], modifies: ["src/app.ts"] }), config, ROOT);
    expect(v.decision).toBe("allow");
    expect(v.needsConfirm).toEqual([]);
  });

  it("a risky-path touch needs a risky-path confirmation", () => {
    const v = evaluate(plan({ touchedFiles: ["src/auth/login.ts"], modifies: ["src/auth/login.ts"] }), config, ROOT);
    expect(v.decision).toBe("allow");
    expect(v.needsConfirm).toContain("risky-path");
  });

  it("a delete needs a delete confirmation", () => {
    const v = evaluate(plan({ touchedFiles: ["src/gone.ts"], deletes: ["src/gone.ts"] }), config, ROOT);
    expect(v.decision).toBe("allow");
    expect(v.needsConfirm).toContain("delete");
  });

  it("matches .env* via a diff a/ prefix", () => {
    const v = evaluate(plan({ touchedFiles: ["a/.env"], modifies: ["a/.env"] }), config, ROOT);
    expect(v.needsConfirm).toContain("risky-path");
  });

  it("matches a Windows-separator risky path", () => {
    const v = evaluate(plan({ touchedFiles: ["src\\auth\\login.ts"], modifies: ["src\\auth\\login.ts"] }), config, ROOT);
    expect(v.needsConfirm).toContain("risky-path");
  });

  it("matches a bare .env dotfile", () => {
    const v = evaluate(plan({ touchedFiles: [".env"], modifies: [".env"] }), config, ROOT);
    expect(v.needsConfirm).toContain("risky-path");
  });

  it("matches .env.local against the .env* glob", () => {
    const v = evaluate(plan({ touchedFiles: [".env.local"], modifies: [".env.local"] }), config, ROOT);
    expect(v.needsConfirm).toContain("risky-path");
  });
});
