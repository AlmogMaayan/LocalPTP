/**
 * Loop-dispatch integration tests (task 7.1).
 *
 * Drives `startRepl` end-to-end with a PassThrough input and verifies that
 * `/lp:*` lines route through `dispatch` (command cores are mocked via
 * vi.mock so no real FS/model/TTY is touched), and that `/exit` resolves the
 * loop promise with 0.
 *
 * Also covers the three inherited-concurrency cases from design.md §7:
 *   (a) a queued line submitted while a deferred no-approval /lp:* core is in
 *       flight runs only after the first settles;
 *   (b) an approval-required /lp:step whose y/N is pushed AFTER the approver's
 *       rl.question callback is installed resolves via the loop's rl;
 *   (c) close (EOF) while a /lp:step dispatch is awaiting its approval
 *       rl.question — the loop promise resolves 0 exactly once and does not hang.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassThrough, Writable } from "node:stream";

// ── Module mocks (must be hoisted) ────────────────────────────────────────────
// Mock only the command modules used by COMMANDS in dispatch.ts so no real
// core/FS/model runs. Each mock returns a minimal valid result.

vi.mock("../../src/commands/doctor.js", () => ({
  runDoctor: vi.fn(),
  formatDoctorResult: vi.fn(() => "Doctor: OK"),
}));

vi.mock("../../src/commands/task.js", () => ({
  runTask: vi.fn(),
  formatTaskResult: vi.fn(() => "Task created"),
}));

vi.mock("../../src/commands/step.js", () => ({
  runStep: vi.fn(),
  formatStepResult: vi.fn(() => "Step done"),
}));

vi.mock("../../src/commands/run.js", () => ({
  run: vi.fn(),
  formatRunResult: vi.fn(() => "Run done"),
}));

vi.mock("../../src/commands/plan.js", () => ({
  runPlan: vi.fn(),
  formatPlanResult: vi.fn(() => "Plan done"),
}));

vi.mock("../../src/commands/index.js", () => ({
  runIndex: vi.fn(),
  formatIndexResult: vi.fn(() => "Index done"),
}));

vi.mock("../../src/commands/context.js", () => ({
  runContext: vi.fn(),
  formatContextResult: vi.fn(() => "Context done"),
}));

vi.mock("../../src/commands/resume.js", () => ({
  runResume: vi.fn(),
  formatResumeResult: vi.fn(() => "Resume done"),
}));

vi.mock("../../src/commands/review.js", () => ({
  runReview: vi.fn(),
  formatReviewResult: vi.fn(() => "Review done"),
}));

vi.mock("../../src/commands/summarize.js", () => ({
  runSummarize: vi.fn(),
  formatSummarizeResult: vi.fn(() => "Summarize done"),
}));

vi.mock("../../src/commands/init.js", () => ({
  runInit: vi.fn(),
  formatInitReport: vi.fn(() => "Init done"),
}));

vi.mock("../../src/commands/config.js", () => ({
  runConfig: vi.fn(),
  formatConfigResult: vi.fn(() => "Config done"),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCapturingOutput(): { output: Writable; getOutput: () => string } {
  let captured = "";
  const output = new Writable({
    write(chunk, _enc, cb) {
      captured += chunk.toString();
      cb();
    },
  });
  return { output, getOutput: () => captured };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("startRepl — dispatch integration (task 7.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("7.1a /lp:doctor routes through dispatch (doctor core stub called), /exit resolves 0", async () => {
    const { runDoctor } = await import("../../src/commands/doctor.js");
    const { startRepl } = await import("../../src/repl/loop.js");

    const mockedRunDoctor = vi.mocked(runDoctor);
    mockedRunDoctor.mockResolvedValue({ reachable: true, model: "test", latencyMs: 10 } as never);

    const input = new PassThrough();
    const { output, getOutput } = makeCapturingOutput();

    const resultPromise = startRepl({ cwd: "/cwd", input, output });

    // Give the REPL time to initialize
    await new Promise<void>((r) => setImmediate(r));

    // Push /lp:doctor line
    input.push("/lp:doctor\n");
    await new Promise<void>((r) => setTimeout(r, 30));

    // Verify doctor core was called
    expect(mockedRunDoctor).toHaveBeenCalledOnce();
    expect(getOutput()).toContain("Doctor: OK");

    // Now push /exit
    input.push("/exit\n");
    const code = await resultPromise;
    expect(code).toBe(0);
  });

  it("7.1a (b) single-flight: queued /lp:* line runs only after deferred first settles", async () => {
    const { runDoctor, formatDoctorResult } = await import("../../src/commands/doctor.js");
    const { startRepl } = await import("../../src/repl/loop.js");

    const mockedRunDoctor = vi.mocked(runDoctor);
    const mockedFormatDoctorResult = vi.mocked(formatDoctorResult);

    const deferA = deferred<unknown>();
    const deferB = deferred<unknown>();
    let callCount = 0;
    let maxConcurrent = 0;
    let concurrent = 0;

    mockedRunDoctor.mockImplementation(async () => {
      callCount++;
      concurrent++;
      if (concurrent > maxConcurrent) maxConcurrent = concurrent;
      const result = callCount === 1 ? await deferA.promise : await deferB.promise;
      concurrent--;
      return result;
    });
    mockedFormatDoctorResult.mockReturnValue("doctor result");

    const input = new PassThrough();
    const { output } = makeCapturingOutput();

    const resultPromise = startRepl({ cwd: "/cwd", input, output });
    await new Promise<void>((r) => setImmediate(r));

    // Push two /lp:doctor lines in one chunk
    input.push("/lp:doctor\n/lp:doctor\n");
    await new Promise<void>((r) => setTimeout(r, 30));

    // First command should be in flight, second queued
    expect(concurrent).toBe(1);
    expect(maxConcurrent).toBe(1);

    // Resolve first
    deferA.resolve({ reachable: true, model: "m", latencyMs: 0 } as never);
    await new Promise<void>((r) => setTimeout(r, 30));

    // Second should now be in flight
    expect(callCount).toBe(2);

    // Resolve second
    deferB.resolve({ reachable: true, model: "m", latencyMs: 0 } as never);
    await new Promise<void>((r) => setTimeout(r, 30));

    input.push(null);
    await resultPromise;

    expect(maxConcurrent).toBe(1);
    expect(mockedRunDoctor).toHaveBeenCalledTimes(2);
  });

  it("7.1b approval-required /lp:step: answer pushed after rl.question resolves via loop rl", async () => {
    const { runStep, formatStepResult } = await import("../../src/commands/step.js");
    const { startRepl } = await import("../../src/repl/loop.js");

    const mockedRunStep = vi.mocked(runStep);
    const mockedFormatStepResult = vi.mocked(formatStepResult);
    mockedFormatStepResult.mockReturnValue("Step applied");

    // Capture the approve function passed to runStep
    let capturedApprove: ((prompt: string) => Promise<boolean>) | undefined;
    const stepDeferred = deferred<unknown>();

    mockedRunStep.mockImplementation(async (opts: Record<string, unknown>) => {
      capturedApprove = opts.approve as (prompt: string) => Promise<boolean>;
      // Call approve as the real step core would
      const approved = await capturedApprove("Apply patch?");
      if (!approved) throw new Error("Not approved");
      // Now resolve the step
      return stepDeferred.promise;
    });

    const input = new PassThrough();
    const { output, getOutput } = makeCapturingOutput();

    const resultPromise = startRepl({ cwd: "/cwd", input, output });
    await new Promise<void>((r) => setImmediate(r));

    // Push /lp:step
    input.push("/lp:step\n");

    // Wait for runStep to start and register rl.question
    // (the question is installed when capturedApprove is called)
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (capturedApprove !== undefined) {
          clearInterval(interval);
          resolve();
        }
      }, 5);
    });

    // Wait a little more for rl.question to be registered
    await new Promise<void>((r) => setTimeout(r, 20));

    // NOW push the approval answer (mirroring interactive user who answers when prompted)
    input.push("y\n");

    // Wait for approval to resolve and step to finish
    await new Promise<void>((r) => setTimeout(r, 50));

    // Resolve the step
    stepDeferred.resolve({ applied: true, done: true, subtaskId: "sub-1" } as never);
    await new Promise<void>((r) => setTimeout(r, 30));

    expect(getOutput()).toContain("Step applied");

    // Push /exit to end the loop
    input.push("/exit\n");
    const code = await resultPromise;
    expect(code).toBe(0);
  });

  it("7.1c close (EOF) while /lp:step awaits approval rl.question → loop resolves 0, no hang", async () => {
    const { runStep, formatStepResult } = await import("../../src/commands/step.js");
    const { startRepl } = await import("../../src/repl/loop.js");

    const mockedRunStep = vi.mocked(runStep);
    const mockedFormatStepResult = vi.mocked(formatStepResult);
    mockedFormatStepResult.mockReturnValue("Step applied");

    // Track when approve is called (i.e., rl.question is registered)
    let approveCalledResolve: (() => void) | undefined;
    const approveCalled = new Promise<void>((r) => {
      approveCalledResolve = r;
    });

    mockedRunStep.mockImplementation(async (opts: Record<string, unknown>) => {
      const approve = opts.approve as (prompt: string) => Promise<boolean>;
      approveCalledResolve?.();
      // Block on approval — this will leave rl.question outstanding
      const approved = await approve("Apply patch?");
      if (!approved) return { applied: false, done: false, subtaskId: "sub-1" } as never;
      return { applied: true, done: true, subtaskId: "sub-1" } as never;
    });

    const input = new PassThrough();
    const { output } = makeCapturingOutput();

    const resultPromise = startRepl({ cwd: "/cwd", input, output });
    await new Promise<void>((r) => setImmediate(r));

    // Push /lp:step — this will trigger approve() → rl.question
    input.push("/lp:step\n");

    // Wait until rl.question is registered (approve has been called)
    await approveCalled;
    await new Promise<void>((r) => setTimeout(r, 20));

    // Close the interface (EOF) while rl.question is outstanding
    input.push(null);

    // The loop should resolve 0 without hanging
    const code = await Promise.race([
      resultPromise,
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error("Loop hung — did not resolve within 2s")), 2000),
      ),
    ]);

    expect(code).toBe(0);
  });
});
