/**
 * `localcoder review` — advisory diff review (tasks 6.1-6.4).
 *
 * Offline: a mock ModelClient (never LM Studio) + a real temp git repo. Asserts
 * the structured/raw print split, the empty-diff exit, the §12 error path, and
 * that the command modifies no file.
 */
import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runReview, formatReviewResult } from "../../src/commands/review.js";
import { ModelClientError, type ModelClient, type ModelResponse } from "../../src/types/model.js";
import { makeTempRepo } from "../helpers/tempRepo.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
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
        "Cannot connect to LM Studio at http://localhost:1234/v1.",
        "http://localhost:1234/v1",
      );
    },
    async health() {
      return { reachable: false };
    },
  };
}

/** Temp repo with a committed base file; optionally make an uncommitted edit. */
async function repoWithChange(change: boolean): Promise<string> {
  const repo = await makeTempRepo({ "base.txt": "line one\n" });
  cleanups.push(repo.cleanup);
  if (change) {
    await fs.writeFile(path.join(repo.root, "base.txt"), "line two\n", "utf8");
  }
  return repo.root;
}

describe("review — structured report (6.1)", () => {
  it("JSON review → structured print; modifies no file", async () => {
    const root = await repoWithChange(true);
    const before = await fs.readFile(path.join(root, "base.txt"), "utf8");
    const json = JSON.stringify({
      summary: "Small one-line change.",
      blocking: ["no test for the new value"],
      nonBlocking: ["consider a constant"],
      missingTests: ["base.txt value"],
      scopeCreep: [],
      recommendation: "request-changes: add a test",
    });
    const result = await runReview({
      cwd: root,
      clientFactory: () => mockClient(json),
    });
    expect(result.hadChanges).toBe(true);
    expect(result.report).toBeDefined();
    expect(result.report!.blocking).toContain("no test for the new value");
    const out = formatReviewResult(result);
    expect(out).toContain("Summary: Small one-line change.");
    expect(out).toContain("no test for the new value");
    expect(out).toContain("consider a constant");
    expect(out).toContain("base.txt value");
    expect(out).toContain("Recommendation: request-changes: add a test");
    // Modified no file.
    expect(await fs.readFile(path.join(root, "base.txt"), "utf8")).toBe(before);
  });
});

describe("review — unparseable falls back to raw (6.2)", () => {
  it("prose review → raw print, command succeeds", async () => {
    const root = await repoWithChange(true);
    const prose = "This looks reasonable overall, but add a test for the new value.";
    const result = await runReview({
      cwd: root,
      clientFactory: () => mockClient(prose),
    });
    expect(result.hadChanges).toBe(true);
    expect(result.report).toBeUndefined();
    expect(result.raw).toBe(prose);
    const out = formatReviewResult(result);
    expect(out).toContain(prose);
  });
});

describe("review — nothing to review (6.3)", () => {
  it("empty diff → 'No changes to review'", async () => {
    const root = await repoWithChange(false);
    let completed = false;
    const result = await runReview({
      cwd: root,
      clientFactory: () => ({
        async complete(): Promise<ModelResponse> {
          completed = true;
          return { content: "{}" };
        },
        async health() {
          return { reachable: true };
        },
      }),
    });
    expect(result.hadChanges).toBe(false);
    expect(formatReviewResult(result)).toBe("No changes to review.");
    // The model's complete() was never called on an empty diff.
    expect(completed).toBe(false);
  });
});

describe("review — model error (6.4)", () => {
  it("§12 model error propagates (caller maps to non-zero exit)", async () => {
    const root = await repoWithChange(true);
    let err: unknown;
    try {
      await runReview({ cwd: root, clientFactory: () => failingClient() });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ModelClientError);
  });
});
