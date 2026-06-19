/**
 * Integration (task 10.1): after task + plan (mock), `context` (0001_03)
 * resolves the active task via active.json.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTask } from "../../src/commands/task.js";
import { runPlan } from "../../src/commands/plan.js";
import { runContext } from "../../src/commands/context.js";
import type { ModelClient, ModelResponse } from "../../src/types/model.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-plan-int-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeFile(rel: string, content: string): Promise<void> {
  const full = path.join(tmp, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

const plan = {
  summary: "Decompose the rename.",
  subtasks: [
    { title: "Edit the label", risk: "low", likelyFiles: ["src/nav.ts"] },
  ],
  risks: [],
  questions: [],
};

function mockClient(): ModelClient {
  return {
    async complete(): Promise<ModelResponse> {
      return { content: JSON.stringify(plan) };
    },
    async health() {
      return { reachable: true, models: ["mock"] };
    },
  };
}

describe("active pointer feeds context (10.1)", () => {
  it("context resolves the active task/session after task + plan", async () => {
    // Index so context has a file to consider for the planner's likelyFiles.
    await writeFile("src/nav.ts", "export const label = 'Alerts';\n");
    await writeFile("ai/coding-rules.md", "# Rules\n");
    const idx = {
      generatedAt: "now",
      root: tmp,
      files: [
        {
          path: "src/nav.ts",
          extension: ".ts",
          size: 30,
          language: "typescript",
          imports: [],
          exports: ["label"],
          isTest: false,
          isConfig: false,
        },
      ],
    };
    await writeFile(".ai-orchestrator/index.json", JSON.stringify(idx, null, 2));

    await runTask({ cwd: tmp, text: "Rename Alerts to Notifications" });
    await runPlan({ cwd: tmp, clientFactory: () => mockClient() });

    const result = await runContext({ cwd: tmp, role: "coder" });
    // No "no active task" warning — the active pointer resolved the task.
    expect(result.pkg.warnings.some((w) => /no active task/i.test(w))).toBe(false);
    // The planner-chosen likelyFile becomes the edit/source file.
    expect(result.pkg.includedSourceFiles).toContain("src/nav.ts");
  });
});
