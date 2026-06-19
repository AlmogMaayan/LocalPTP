/**
 * `localcoder summarize` command (tasks 4.1–4.8), all offline against a mock client.
 *
 * Strategy:
 *   - Use runTask() to create an active session + task.
 *   - Pass a mock ModelClient via clientFactory.
 *   - Inspect /ai/*.md files and the session file directly.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTask } from "../../src/commands/task.js";
import { runSummarize } from "../../src/commands/summarize.js";
import { loadSession } from "../../src/core/sessionManager.js";
import { readActive } from "../../src/core/activePointer.js";
import {
  ModelClientError,
  type ModelClient,
  type ModelResponse,
} from "../../src/types/model.js";
import { layout } from "../../src/utils/paths.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-summarize-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function mockClient(content: string): ModelClient {
  return {
    async complete(): Promise<ModelResponse> {
      return { content };
    },
    async health() {
      return { reachable: true, models: ["mock"] };
    },
  };
}

function failingClient(): ModelClient {
  return {
    async complete(): Promise<ModelResponse> {
      throw new ModelClientError(
        "refused",
        "Cannot connect to LM Studio at http://localhost:1234/v1. Make sure LM Studio Local Server is running and the model is loaded.",
        "http://localhost:1234/v1",
      );
    },
    async health() {
      return { reachable: false };
    },
  };
}

const wellFormedSummary = {
  sessionUpdate: {
    currentState: "Implemented the new feature",
    filesChanged: ["src/foo.ts", "src/bar.ts"],
    decisions: ["Used pattern X"],
    risks: ["Potential memory leak"],
  },
  memoryUpdates: [
    { changeType: "architectural-decision", content: "chose X over Y pattern" },
    { changeType: "risk", content: "potential memory leak in the new module" },
  ],
  nextStep: "Write tests for the new feature",
};

async function setupTask(): Promise<void> {
  await runTask({ cwd: tmp, text: "Implement the new feature" });
  // scaffold /ai directory with a few memory files for verification
  const l = layout(tmp);
  await fs.mkdir(l.aiDir, { recursive: true });
  // pre-create decisions.md and known-issues.md with existing prose
  await fs.writeFile(
    path.join(l.aiDir, "decisions.md"),
    "# Decisions\n\nUser-written prose here.\n\n## Architectural Decisions\n- 2024-01-01 — old decision\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(l.aiDir, "known-issues.md"),
    "# Known Issues\n\n## Risks / Known Issues\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(l.aiDir, "api-map.md"),
    "# API Map\n\nLeave me alone.\n",
    "utf8",
  );
}

const TODAY = new Date().toISOString().slice(0, 10);

describe("summarize happy path (4.1)", () => {
  it("session updated + exactly the policy-table files appended; others untouched", async () => {
    await setupTask();
    const ptr = await readActive(path.join(tmp, ".ai-orchestrator"));
    const l = layout(tmp);

    const apiMapBefore = await fs.readFile(path.join(l.aiDir, "api-map.md"), "utf8");

    const result = await runSummarize({
      cwd: tmp,
      clientFactory: () => mockClient(JSON.stringify(wellFormedSummary)),
    });

    // Session was updated
    const session = await loadSession(ptr!.sessionPath);
    expect(session.currentState).toContain("Implemented the new feature");
    expect(session.nextStep).toContain("Write tests");

    // decisions.md was appended with the architectural decision
    const decisions = await fs.readFile(path.join(l.aiDir, "decisions.md"), "utf8");
    expect(decisions).toContain(`- ${TODAY} — chose X over Y pattern`);
    // User prose preserved
    expect(decisions).toContain("User-written prose here.");
    expect(decisions).toContain("- 2024-01-01 — old decision");

    // known-issues.md was appended with the risk
    const knownIssues = await fs.readFile(path.join(l.aiDir, "known-issues.md"), "utf8");
    expect(knownIssues).toContain(`- ${TODAY} — potential memory leak in the new module`);

    // api-map.md was NOT modified (not mentioned in the wellFormedSummary)
    const apiMapAfter = await fs.readFile(path.join(l.aiDir, "api-map.md"), "utf8");
    expect(apiMapAfter).toBe(apiMapBefore);

    // result shape
    expect(result.updatedFiles).toContain("decisions.md");
    expect(result.updatedFiles).toContain("known-issues.md");
    expect(result.ignored).toEqual([]);
  });
});

describe("summarize policy mapping (4.2)", () => {
  it("architectural-decision → decisions.md, risk → known-issues.md, etc.", async () => {
    await setupTask();
    const l = layout(tmp);

    const policyTest = {
      sessionUpdate: { currentState: "done" },
      memoryUpdates: [
        { changeType: "architectural-decision", content: "decision A" },
        { changeType: "risk", content: "risk A" },
        { changeType: "api-behavior", content: "api A" },
        { changeType: "data-model", content: "data A" },
        { changeType: "testing-process", content: "test A" },
        { changeType: "external-integration", content: "ext A" },
        { changeType: "file-responsibility", content: "file A" },
      ],
      nextStep: "done",
    };

    // ensure all target files exist
    await fs.writeFile(path.join(l.aiDir, "api-map.md"), "# API Map\n\n## API Behavior Changes\n", "utf8");
    await fs.writeFile(path.join(l.aiDir, "data-model.md"), "# Data Model\n\n## Data Model Changes\n", "utf8");
    await fs.writeFile(path.join(l.aiDir, "test-plan.md"), "# Test Plan\n\n## Testing Process Changes\n", "utf8");
    await fs.writeFile(path.join(l.aiDir, "external-integrations.md"), "# External Integrations\n\n## External Integration Changes\n", "utf8");
    await fs.writeFile(path.join(l.aiDir, "file-index.md"), "# File Index\n\n## File Responsibility Changes\n", "utf8");

    await runSummarize({
      cwd: tmp,
      clientFactory: () => mockClient(JSON.stringify(policyTest)),
    });

    expect(await fs.readFile(path.join(l.aiDir, "decisions.md"), "utf8")).toContain("decision A");
    expect(await fs.readFile(path.join(l.aiDir, "known-issues.md"), "utf8")).toContain("risk A");
    expect(await fs.readFile(path.join(l.aiDir, "api-map.md"), "utf8")).toContain("api A");
    expect(await fs.readFile(path.join(l.aiDir, "data-model.md"), "utf8")).toContain("data A");
    expect(await fs.readFile(path.join(l.aiDir, "test-plan.md"), "utf8")).toContain("test A");
    expect(await fs.readFile(path.join(l.aiDir, "external-integrations.md"), "utf8")).toContain("ext A");
    expect(await fs.readFile(path.join(l.aiDir, "file-index.md"), "utf8")).toContain("file A");
  });

  it("out-of-table changeType is ignored + warning", async () => {
    await setupTask();
    const l = layout(tmp);

    const warnSpy: string[] = [];
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as { write: (s: string) => void }).write = (s: string) => {
      warnSpy.push(s);
      return true;
    };

    try {
      const result = await runSummarize({
        cwd: tmp,
        clientFactory: () =>
          mockClient(
            JSON.stringify({
              sessionUpdate: { currentState: "done" },
              memoryUpdates: [
                { changeType: "completely-unknown-type", content: "something" },
                { changeType: "architectural-decision", content: "a valid one" },
              ],
              nextStep: "next",
            }),
          ),
      });

      // The unknown type should be in ignored
      expect(result.ignored).toContain("completely-unknown-type");
      // The valid one should be in updatedFiles
      expect(result.updatedFiles).toContain("decisions.md");

      // A warning should have been emitted
      const allWarnings = warnSpy.join(" ");
      expect(allWarnings).toMatch(/unknown|ignore|warn/i);
    } finally {
      (process.stderr as { write: (s: string) => void }).write = originalStderrWrite as (s: string) => void;
    }
  });
});

describe("summarize security: model-named file is ignored (4.3)", () => {
  it("a memoryUpdate with a model-provided file field is still resolved by changeType only", async () => {
    await setupTask();
    const l = layout(tmp);

    // The model tries to sneak a 'file' field into the memoryUpdate — the code
    // must resolve by changeType only, never by model-named file.
    const maliciousSummary = {
      sessionUpdate: { currentState: "done" },
      memoryUpdates: [
        {
          changeType: "architectural-decision",
          file: ".env", // should be IGNORED
          content: "decision here",
        },
      ],
      nextStep: "next",
    };

    await runSummarize({
      cwd: tmp,
      clientFactory: () => mockClient(JSON.stringify(maliciousSummary)),
    });

    // .env should NOT have been created or modified
    const envExists = await fs
      .access(path.join(tmp, ".env"))
      .then(() => true)
      .catch(() => false);
    expect(envExists).toBe(false);

    // decisions.md SHOULD have been updated (correct resolution by changeType)
    const decisions = await fs.readFile(path.join(l.aiDir, "decisions.md"), "utf8");
    expect(decisions).toContain("decision here");
  });
});

describe("summarize no active session (4.4)", () => {
  it("error + non-zero exit when no active session is set", async () => {
    let err: unknown;
    try {
      await runSummarize({
        cwd: tmp,
        clientFactory: () => mockClient("{}"),
      });
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(Error);
    expect((err as { exitCode?: number }).exitCode).toBe(1);
    expect((err as Error).message).toMatch(/task|session/i);
  });
});

describe("summarize no git diff (4.5)", () => {
  it("progress-only summary still updates the session", async () => {
    await setupTask();
    const ptr = await readActive(path.join(tmp, ".ai-orchestrator"));

    // Mock a summary that has no memoryUpdates (no git diff scenario)
    const progressOnlySummary = {
      sessionUpdate: {
        currentState: "No changes yet; reviewed the codebase",
        filesChanged: [],
        decisions: [],
        risks: [],
      },
      memoryUpdates: [],
      nextStep: "Begin implementing the feature",
    };

    await runSummarize({
      cwd: tmp,
      clientFactory: () => mockClient(JSON.stringify(progressOnlySummary)),
    });

    const session = await loadSession(ptr!.sessionPath);
    expect(session.currentState).toContain("No changes yet");
    expect(session.nextStep).toContain("Begin implementing");
  });
});

describe("summarize unparseable output (4.6)", () => {
  it("minimal session-only note + warning + non-zero exit, no memory writes", async () => {
    await setupTask();
    const ptr = await readActive(path.join(tmp, ".ai-orchestrator"));
    const l = layout(tmp);

    const decisionsBefore = await fs.readFile(path.join(l.aiDir, "decisions.md"), "utf8");

    let err: unknown;
    try {
      await runSummarize({
        cwd: tmp,
        clientFactory: () => mockClient("not json at all, just some random text"),
      });
    } catch (e) {
      err = e;
    }

    // Non-zero exit
    expect(err).toBeInstanceOf(Error);
    expect((err as { exitCode?: number }).exitCode).toBe(1);

    // Session got a minimal note (it was updated)
    const session = await loadSession(ptr!.sessionPath);
    expect(session.currentState).toMatch(/unparseable|attempted|summary/i);

    // Memory files NOT written
    const decisionsAfter = await fs.readFile(path.join(l.aiDir, "decisions.md"), "utf8");
    expect(decisionsAfter).toBe(decisionsBefore);
  });
});

describe("summarize model error (4.7)", () => {
  it("§12 model error → nothing written + non-zero exit", async () => {
    await setupTask();
    const ptr = await readActive(path.join(tmp, ".ai-orchestrator"));
    const l = layout(tmp);

    const sessionBefore = await fs.readFile(ptr!.sessionPath, "utf8");
    const decisionsBefore = await fs.readFile(path.join(l.aiDir, "decisions.md"), "utf8");

    let err: unknown;
    try {
      await runSummarize({
        cwd: tmp,
        clientFactory: () => failingClient(),
      });
    } catch (e) {
      err = e;
    }

    // Should propagate as ModelClientError
    expect(err).toBeInstanceOf(ModelClientError);

    // Nothing written
    expect(await fs.readFile(ptr!.sessionPath, "utf8")).toBe(sessionBefore);
    expect(await fs.readFile(path.join(l.aiDir, "decisions.md"), "utf8")).toBe(decisionsBefore);
  });
});

describe("summarize de-duplication and --json (4.8)", () => {
  it("repeated summarize does not duplicate identical same-day entry", async () => {
    await setupTask();
    const l = layout(tmp);

    const summary = {
      sessionUpdate: { currentState: "done" },
      memoryUpdates: [
        { changeType: "architectural-decision", content: "same exact decision" },
      ],
      nextStep: "next",
    };

    // Run twice
    await runSummarize({
      cwd: tmp,
      clientFactory: () => mockClient(JSON.stringify(summary)),
    });
    await runSummarize({
      cwd: tmp,
      clientFactory: () => mockClient(JSON.stringify(summary)),
    });

    const decisions = await fs.readFile(path.join(l.aiDir, "decisions.md"), "utf8");
    const count = (decisions.match(/same exact decision/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("--json emits { session, updatedFiles[], ignored[] }", async () => {
    await setupTask();

    const result = await runSummarize({
      cwd: tmp,
      json: true,
      clientFactory: () => mockClient(JSON.stringify(wellFormedSummary)),
    });

    expect(result).toHaveProperty("session");
    expect(result).toHaveProperty("updatedFiles");
    expect(result).toHaveProperty("ignored");
    expect(Array.isArray(result.updatedFiles)).toBe(true);
    expect(Array.isArray(result.ignored)).toBe(true);
    expect(result.json).toBe(true);
  });
});
