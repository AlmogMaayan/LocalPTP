/**
 * Tests for ContextPackage schema + tolerant task/session parsing (tasks 1.1, 1.2).
 */
import { describe, it, expect } from "vitest";
import {
  contextPackageSchema,
  parseActiveTask,
  parseActiveSession,
  firstIncompleteSubtask,
  type ContextPackage,
} from "../../src/types/context.js";

describe("contextPackageSchema (1.1)", () => {
  const valid: ContextPackage = {
    role: "coder",
    systemPrompt: "sys",
    userPrompt: "user",
    includedMemoryFiles: ["coding-rules.md"],
    includedSourceFiles: ["src/a.ts"],
    includedTestFiles: [],
    estimatedTokens: 42,
    warnings: [],
  };

  it("parses a valid package", () => {
    const result = contextPackageSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("fails when estimatedTokens is missing", () => {
    const { estimatedTokens, ...missing } = valid;
    void estimatedTokens;
    const result = contextPackageSchema.safeParse(missing);
    expect(result.success).toBe(false);
  });
});

describe("parseActiveTask + firstIncompleteSubtask (1.2)", () => {
  const taskMd = `# Task

## Goal

Add a navbar to the app.

## Subtasks

- [x] Scaffold the component
  likelyFiles: src/components/NavBar.tsx, src/components/NavBar.test.tsx
- [ ] Wire it into the layout
  likelyFiles: src/App.tsx
- [ ] Add i18n strings
  likelyFiles: src/i18n/en.json

## Next Step

Wire it into the layout.
`;

  it("parses a 0001_04-shaped task md", () => {
    const task = parseActiveTask(taskMd);
    expect(task.goal).toContain("Add a navbar");
    expect(task.subtasks?.length).toBe(3);
    expect(task.subtasks?.[0].likelyFiles).toEqual([
      "src/components/NavBar.tsx",
      "src/components/NavBar.test.tsx",
    ]);
    expect(task.raw).toBe(taskMd);
  });

  it("resolves the first incomplete subtask deterministically", () => {
    const task = parseActiveTask(taskMd);
    const sub = firstIncompleteSubtask(task);
    expect(sub?.likelyFiles).toEqual(["src/App.tsx"]);
  });

  it("falls back to the first subtask when none is incomplete", () => {
    const allDone = `## Goal\n\nX\n\n## Subtasks\n\n- [x] one\n  likelyFiles: a.ts\n- [x] two\n  likelyFiles: b.ts\n`;
    const task = parseActiveTask(allDone);
    const sub = firstIncompleteSubtask(task);
    expect(sub?.likelyFiles).toEqual(["a.ts"]);
  });

  it("tolerates missing fields / no checkboxes", () => {
    const sparse = `# Some notes\n\nNo goal heading, no subtasks.\n`;
    const task = parseActiveTask(sparse);
    expect(task.goal).toBeUndefined();
    expect(firstIncompleteSubtask(task)).toBeUndefined();
    expect(task.raw).toBe(sparse);
  });

  it("parses an active session tolerantly", () => {
    const sessionMd = `# Session\n\n## Current State\n\nMidway through the navbar.\n\n## Next Step\n\nWire it into the layout.\n`;
    const session = parseActiveSession(sessionMd);
    expect(session.currentState).toContain("Midway");
    expect(session.nextStep).toContain("Wire it");
    expect(session.raw).toBe(sessionMd);
  });
});
