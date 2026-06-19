/**
 * Test Runner — runTests via execa, report-only (tasks 5.1-5.2).
 */
import { describe, it, expect } from "vitest";
import { runTests } from "../../src/core/testRunner.js";

describe("runTests (5.1)", () => {
  it("captures a passing command (exit 0) with output and duration", async () => {
    const results = await runTests([["node", ["-e", "process.stdout.write('ok')"]]]);
    expect(results).toHaveLength(1);
    expect(results[0].exitCode).toBe(0);
    expect(results[0].stdout).toContain("ok");
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(results[0].command).toContain("node");
  });

  it("captures a failing command (exit != 0) without throwing", async () => {
    const results = await runTests([["node", ["-e", "process.exit(3)"]]]);
    expect(results).toHaveLength(1);
    expect(results[0].exitCode).toBe(3);
  });

  it("runs multiple commands in order and reports each", async () => {
    const results = await runTests([
      ["node", ["-e", "process.exit(0)"]],
      ["node", ["-e", "process.exit(1)"]],
    ]);
    expect(results.map((r) => r.exitCode)).toEqual([0, 1]);
  });

  it("returns [] for no commands", async () => {
    expect(await runTests([])).toEqual([]);
  });
});
