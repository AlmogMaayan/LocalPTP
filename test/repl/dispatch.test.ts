/**
 * Tests for `dispatch` — the REPL command dispatcher.
 *
 * Uses the injectable `commands` test seam (third parameter) to avoid any real
 * cores, FS, model, or TTY usage. Separate "production-fidelity" tests (tasks
 * 3.4 and 4.4) import the real `COMMANDS` table directly.
 */
import { describe, it, expect, vi } from "vitest";
import type { Interface as RlInterface } from "node:readline";
import { Writable } from "node:stream";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A capturing writable stream that accumulates written output. */
function makeOutput(): { output: Writable; getOutput: () => string } {
  let captured = "";
  const output = new Writable({
    write(chunk, _enc, cb) {
      captured += chunk.toString();
      cb();
    },
  });
  return { output, getOutput: () => captured };
}

/** A minimal fake readline.Interface for tests that don't need rl.question. */
function makeFakeRl(): RlInterface {
  const emitter = {
    question: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
    prompt: vi.fn(),
    close: vi.fn(),
    emit: vi.fn(),
  } as unknown as RlInterface;
  return emitter;
}

/** A fake rl that records rl.question calls and can resolve them on demand. */
function makeQuestionRl(): {
  rl: RlInterface;
  answerQuestion: (answer: string) => void;
  getLastQuestion: () => string | undefined;
} {
  let lastCb: ((answer: string) => void) | undefined;
  let lastQuestion: string | undefined;
  const rl = {
    question(q: string, cb: (answer: string) => void) {
      lastQuestion = q;
      lastCb = cb;
    },
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
    prompt: vi.fn(),
    close: vi.fn(),
    emit: vi.fn(),
  } as unknown as RlInterface;
  return {
    rl,
    answerQuestion: (answer: string) => {
      if (lastCb) lastCb(answer);
    },
    getLastQuestion: () => lastQuestion,
  };
}

const DEFAULT_CWD = "/test/cwd";

// ── § 2 No-arg command dispatch ───────────────────────────────────────────────

describe("dispatch — no-arg command (task 2.1)", () => {
  it("2.1 /lp:doctor calls the doctor entry run and writes formatted output", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    const fakeResult = { ok: true };
    const run = vi.fn().mockResolvedValue(fakeResult);
    const format = vi.fn().mockReturnValue("Doctor output");
    const fakeCommands = {
      doctor: { run, format, buildOptions: () => ({}) },
    };

    const result = await dispatch(
      "/lp:doctor",
      { cwd: DEFAULT_CWD, rl, output },
      fakeCommands,
    );

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: DEFAULT_CWD }));
    expect(format).toHaveBeenCalledWith(fakeResult);
    expect(getOutput()).toContain("Doctor output");
    expect(result).toEqual({ exit: false });
  });
});

// ── § 3 Argument mapping ──────────────────────────────────────────────────────

describe("dispatch — argument mapping (task 3.1)", () => {
  it('/lp:task "Add X" calls run with text:"Add X"', async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output } = makeOutput();
    const rl = makeFakeRl();

    const run = vi.fn().mockResolvedValue({});
    const format = vi.fn().mockReturnValue("task result");
    const fakeCommands = {
      task: {
        run,
        format,
        buildOptions: (tokens: string[]) => ({ text: tokens.join(" ") }),
      },
    };

    await dispatch('/lp:task "Add X"', { cwd: DEFAULT_CWD, rl, output }, fakeCommands);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ text: "Add X" }));
  });

  it("/lp:config model.baseUrl http://x calls run with key,value", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output } = makeOutput();
    const rl = makeFakeRl();

    const run = vi.fn().mockResolvedValue({});
    const format = vi.fn().mockReturnValue("config result");
    const fakeCommands = {
      config: {
        run,
        format,
        buildOptions: (tokens: string[]) => ({ key: tokens[0], value: tokens[1] }),
      },
    };

    await dispatch(
      "/lp:config model.baseUrl http://x",
      { cwd: DEFAULT_CWD, rl, output },
      fakeCommands,
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ key: "model.baseUrl", value: "http://x" }),
    );
  });

  it("/lp:resume 2 calls run with index:2", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output } = makeOutput();
    const rl = makeFakeRl();

    const run = vi.fn().mockResolvedValue({});
    const format = vi.fn().mockReturnValue("resume result");
    const fakeCommands = {
      resume: {
        run,
        format,
        buildOptions: (tokens: string[]) => ({
          index: tokens[0] !== undefined ? Number(tokens[0]) : undefined,
        }),
      },
    };

    await dispatch("/lp:resume 2", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ index: 2 }));
  });

  it("/lp:context coder calls run with role:coder", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output } = makeOutput();
    const rl = makeFakeRl();

    const run = vi.fn().mockResolvedValue({});
    const format = vi.fn().mockReturnValue("context result");
    const fakeCommands = {
      context: {
        run,
        format,
        buildOptions: (tokens: string[]) => ({ role: tokens[0] }),
      },
    };

    await dispatch("/lp:context coder", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ role: "coder" }));
  });
});

// ── § 3.4 buildOptions fidelity on the production COMMANDS ───────────────────

describe("COMMANDS.buildOptions fidelity (task 3.4)", () => {
  it("task joins tokens into text", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    expect(COMMANDS.task.buildOptions(["a", "b"], {} as never)).toEqual({ text: "a b" });
  });

  it("context maps first token to role", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    expect(COMMANDS.context.buildOptions(["coder"], {} as never)).toEqual({ role: "coder" });
  });

  it("config maps first two tokens to key,value", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    expect(COMMANDS.config.buildOptions(["k", "v"], {} as never)).toEqual({
      key: "k",
      value: "v",
    });
  });

  it("resume parses first token as positive integer index", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    expect(COMMANDS.resume.buildOptions(["2"], {} as never)).toEqual({ index: 2 });
  });

  it("plan returns {} even with surplus tokens", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    expect(COMMANDS.plan.buildOptions(["x"], {} as never)).toEqual({});
  });

  it("index returns {} even with surplus tokens", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    expect(COMMANDS.index.buildOptions(["x"], {} as never)).toEqual({});
  });

  it("review returns {} even with surplus tokens", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    expect(COMMANDS.review.buildOptions(["x"], {} as never)).toEqual({});
  });

  it("summarize returns {} even with surplus tokens", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    expect(COMMANDS.summarize.buildOptions(["x"], {} as never)).toEqual({});
  });

  it("init returns {} even with surplus tokens", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    expect(COMMANDS.init.buildOptions(["x"], {} as never)).toEqual({});
  });

  it("doctor returns {} even with surplus tokens", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    expect(COMMANDS.doctor.buildOptions(["x"], {} as never)).toEqual({});
  });

  it("context with empty tokens maps role to undefined", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    expect(COMMANDS.context.buildOptions([], {} as never)).toEqual({ role: undefined });
  });

  it("config with empty tokens maps key and value to undefined", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    expect(COMMANDS.config.buildOptions([], {} as never)).toEqual({
      key: undefined,
      value: undefined,
    });
  });

  it("resume with empty tokens maps index to undefined (no parse error)", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    expect(COMMANDS.resume.buildOptions([], {} as never)).toEqual({ index: undefined });
  });

  it("context drops surplus tokens beyond first", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    expect(COMMANDS.context.buildOptions(["coder", "extra"], {} as never)).toEqual({
      role: "coder",
    });
  });

  it("config drops surplus tokens beyond second", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    expect(COMMANDS.config.buildOptions(["k", "v", "extra"], {} as never)).toEqual({
      key: "k",
      value: "v",
    });
  });
});

// ── § 4 Approver injection for step/run ───────────────────────────────────────

describe("dispatch — approver injection (task 4.1)", () => {
  it("/lp:step injects approve function via real buildOptions, NOT ttyApprove", async () => {
    const { dispatch, COMMANDS } = await import("../../src/repl/dispatch.js");
    const { output } = makeOutput();
    const { rl, answerQuestion } = makeQuestionRl();

    const run = vi.fn().mockResolvedValue({});
    const format = vi.fn().mockReturnValue("step result");

    // Use the REAL buildOptions (which calls replApprover) but stub run/format.
    const fakeCommands = {
      step: {
        run,
        format,
        buildOptions: COMMANDS.step.buildOptions,
      },
    };

    await dispatch("/lp:step", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);

    expect(run).toHaveBeenCalledOnce();
    const opts = run.mock.calls[0][0] as { approve?: unknown };
    expect(typeof opts.approve).toBe("function");

    // Verify calling approve drives rl.question
    const approveFn = opts.approve as (prompt: string) => Promise<boolean>;
    const approvePromise = approveFn("Are you sure?");
    answerQuestion("y");
    const approved = await approvePromise;
    expect(approved).toBe(true);
  });

  it("/lp:run injects approve function via real buildOptions, NOT ttyApprove", async () => {
    const { dispatch, COMMANDS } = await import("../../src/repl/dispatch.js");
    const { output } = makeOutput();
    const { rl } = makeQuestionRl();

    const run = vi.fn().mockResolvedValue({});
    const format = vi.fn().mockReturnValue("run result");

    const fakeCommands = {
      run: {
        run,
        format,
        buildOptions: COMMANDS.run.buildOptions,
      },
    };

    await dispatch("/lp:run", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);

    const opts = run.mock.calls[0][0] as { approve?: unknown };
    expect(typeof opts.approve).toBe("function");
  });
});

// ── § 4.4 All-twelve production-fidelity test ─────────────────────────────────

describe("COMMANDS production-fidelity (task 4.4) — all 12 entries", () => {
  it("each command wires the correct run/format pair from the real command modules", async () => {
    const { COMMANDS } = await import("../../src/repl/dispatch.js");

    const { runTask, formatTaskResult } = await import("../../src/commands/task.js");
    const { runPlan, formatPlanResult } = await import("../../src/commands/plan.js");
    const { runStep, formatStepResult } = await import("../../src/commands/step.js");
    const { run: runRun, formatRunResult } = await import("../../src/commands/run.js");
    const { runIndex, formatIndexResult } = await import("../../src/commands/index.js");
    const { runContext, formatContextResult } = await import("../../src/commands/context.js");
    const { runResume, formatResumeResult } = await import("../../src/commands/resume.js");
    const { runReview, formatReviewResult } = await import("../../src/commands/review.js");
    const { runSummarize, formatSummarizeResult } = await import(
      "../../src/commands/summarize.js"
    );
    const { runInit, formatInitReport } = await import("../../src/commands/init.js");
    const { runConfig, formatConfigResult } = await import("../../src/commands/config.js");
    const { runDoctor, formatDoctorResult } = await import("../../src/commands/doctor.js");

    expect(COMMANDS.task.run).toBe(runTask);
    expect(COMMANDS.task.format).toBe(formatTaskResult);

    expect(COMMANDS.plan.run).toBe(runPlan);
    expect(COMMANDS.plan.format).toBe(formatPlanResult);

    expect(COMMANDS.step.run).toBe(runStep);
    expect(COMMANDS.step.format).toBe(formatStepResult);

    expect(COMMANDS.run.run).toBe(runRun);
    expect(COMMANDS.run.format).toBe(formatRunResult);

    expect(COMMANDS.index.run).toBe(runIndex);
    expect(COMMANDS.index.format).toBe(formatIndexResult);

    expect(COMMANDS.context.run).toBe(runContext);
    expect(COMMANDS.context.format).toBe(formatContextResult);

    expect(COMMANDS.resume.run).toBe(runResume);
    expect(COMMANDS.resume.format).toBe(formatResumeResult);

    expect(COMMANDS.review.run).toBe(runReview);
    expect(COMMANDS.review.format).toBe(formatReviewResult);

    expect(COMMANDS.summarize.run).toBe(runSummarize);
    expect(COMMANDS.summarize.format).toBe(formatSummarizeResult);

    expect(COMMANDS.init.run).toBe(runInit);
    expect(COMMANDS.init.format).toBe(formatInitReport);

    expect(COMMANDS.config.run).toBe(runConfig);
    expect(COMMANDS.config.format).toBe(formatConfigResult);

    expect(COMMANDS.doctor.run).toBe(runDoctor);
    expect(COMMANDS.doctor.format).toBe(formatDoctorResult);
  });
});

// ── § 5 Meta-commands and unknowns ────────────────────────────────────────────

describe("dispatch — meta-commands (task 5.1)", () => {
  it("/help lists every /lp:<cmd> and meta-commands /help /exit /clear", async () => {
    const { dispatch, COMMANDS } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    // Use a fake commands table with a subset to verify it's derived from the table
    const fakeCommands = {
      doctor: { run: vi.fn(), format: vi.fn().mockReturnValue(""), buildOptions: () => ({}) },
      task: { run: vi.fn(), format: vi.fn().mockReturnValue(""), buildOptions: () => ({}) },
    };

    await dispatch("/help", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);

    const out = getOutput();
    // Should list lp commands from the fake table
    expect(out).toContain("/lp:doctor");
    expect(out).toContain("/lp:task");
    // Should list meta-commands
    expect(out).toContain("/help");
    expect(out).toContain("/exit");
    expect(out).toContain("/clear");

    // Test with the real COMMANDS to ensure production surface is covered
    const { output: out2, getOutput: getOut2 } = makeOutput();
    await dispatch("/help", { cwd: DEFAULT_CWD, rl, output: out2 });
    const out2Text = getOut2();
    for (const name of Object.keys(COMMANDS)) {
      expect(out2Text).toContain(`/lp:${name}`);
    }
    expect(out2Text).toContain("/help");
    expect(out2Text).toContain("/exit");
    expect(out2Text).toContain("/clear");
  });

  it("/exit returns { exit: true }", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output } = makeOutput();
    const rl = makeFakeRl();

    const result = await dispatch("/exit", { cwd: DEFAULT_CWD, rl, output });
    expect(result).toEqual({ exit: true });
  });

  it("/clear writes the ANSI clear sequence and returns { exit: false }", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    const result = await dispatch("/clear", { cwd: DEFAULT_CWD, rl, output });
    expect(result).toEqual({ exit: false });
    expect(getOutput()).toContain("\x1b[2J");
  });

  it("/lp:nope (unknown /lp: command) → unknown-command message", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    const result = await dispatch("/lp:nope", { cwd: DEFAULT_CWD, rl, output }, {});
    expect(result).toEqual({ exit: false });
    expect(getOutput()).toContain("Unknown command. Type /help for commands.");
  });

  it("/nope (unknown bare slash) → unknown-command message", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    const result = await dispatch("/nope", { cwd: DEFAULT_CWD, rl, output }, {});
    expect(result).toEqual({ exit: false });
    expect(getOutput()).toContain("Unknown command. Type /help for commands.");
  });

  it('/nope "unterminated (bare meta with unbalanced quote) → unknown-command message', async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    // Bare meta lines are not tokenized, so unbalanced quote here => unknown
    const result = await dispatch('/nope "unterminated', { cwd: DEFAULT_CWD, rl, output }, {});
    expect(result).toEqual({ exit: false });
    expect(getOutput()).toContain("Unknown command. Type /help for commands.");
  });

  it("/lp:constructor → unknown-command (prototype-pollution guard)", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    const result = await dispatch("/lp:constructor", { cwd: DEFAULT_CWD, rl, output }, {});
    expect(result).toEqual({ exit: false });
    expect(getOutput()).toContain("Unknown command. Type /help for commands.");
  });

  it("/lp:toString → unknown-command (prototype-pollution guard)", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    const result = await dispatch("/lp:toString", { cwd: DEFAULT_CWD, rl, output }, {});
    expect(result).toEqual({ exit: false });
    expect(getOutput()).toContain("Unknown command. Type /help for commands.");
  });

  it("/lp:__proto__ → unknown-command (prototype-pollution guard)", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    const result = await dispatch("/lp:__proto__", { cwd: DEFAULT_CWD, rl, output }, {});
    expect(result).toEqual({ exit: false });
    expect(getOutput()).toContain("Unknown command. Type /help for commands.");
  });
});

// ── § 6 Error resilience ──────────────────────────────────────────────────────

describe("dispatch — error resilience (task 6.1)", () => {
  it("a dispatched core that throws writes the message and returns { exit: false }", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    const run = vi.fn().mockRejectedValue(new Error("model unreachable"));
    const format = vi.fn().mockReturnValue("");
    const fakeCommands = {
      doctor: { run, format, buildOptions: () => ({}) },
    };

    const result = await dispatch("/lp:doctor", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);
    expect(result).toEqual({ exit: false });
    expect(getOutput()).toContain("model unreachable");
  });

  it("a non-Error throw prints String(e)", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    const run = vi.fn().mockRejectedValue("raw string error");
    const format = vi.fn().mockReturnValue("");
    const fakeCommands = {
      doctor: { run, format, buildOptions: () => ({}) },
    };

    const result = await dispatch("/lp:doctor", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);
    expect(result).toEqual({ exit: false });
    // Must print String(e), never "undefined"
    expect(getOutput()).toContain("raw string error");
    expect(getOutput()).not.toContain("undefined");
  });

  it("unbalanced quote on /lp: line prints friendly parse error, { exit: false }", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    const result = await dispatch('/lp:task "Add', { cwd: DEFAULT_CWD, rl, output }, {});
    expect(result).toEqual({ exit: false });
    expect(getOutput()).toContain("Unbalanced quote");
  });

  it("/lp: with no command → unknown-command message", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    const result = await dispatch("/lp:", { cwd: DEFAULT_CWD, rl, output }, {});
    expect(result).toEqual({ exit: false });
    expect(getOutput()).toContain("Unknown command. Type /help for commands.");
  });

  it("/lp:resume abc → friendly parse error, resume core NOT called", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    const run = vi.fn().mockResolvedValue({});
    const format = vi.fn().mockReturnValue("resume result");

    // Use the REAL COMMANDS.resume buildOptions to test parseIndex rejection
    const { COMMANDS } = await import("../../src/repl/dispatch.js");
    const fakeCommands = {
      resume: { run, format, buildOptions: COMMANDS.resume.buildOptions },
    };

    const result = await dispatch(
      "/lp:resume abc",
      { cwd: DEFAULT_CWD, rl, output },
      fakeCommands,
    );
    expect(result).toEqual({ exit: false });
    expect(run).not.toHaveBeenCalled();
    expect(getOutput()).toContain("Invalid resume index");
  });

  it("/lp:task with no text → core's empty-text guard message written, { exit: false }", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    const run = vi.fn().mockRejectedValue(new Error("Task text cannot be empty"));
    const format = vi.fn().mockReturnValue("task result");
    const fakeCommands = {
      task: {
        run,
        format,
        buildOptions: (tokens: string[]) => ({ text: tokens.join(" ") }),
      },
    };

    const result = await dispatch("/lp:task", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);
    expect(result).toEqual({ exit: false });
    expect(getOutput()).toContain("Task text cannot be empty");
  });

  it("/lp:plan foo → extras ignored, core still runs", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output } = makeOutput();
    const rl = makeFakeRl();

    const run = vi.fn().mockResolvedValue({});
    const format = vi.fn().mockReturnValue("plan result");
    const fakeCommands = {
      plan: { run, format, buildOptions: () => ({}) },
    };

    const result = await dispatch("/lp:plan foo", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);
    expect(result).toEqual({ exit: false });
    expect(run).toHaveBeenCalledOnce();
  });

  it("parseIndex rejects 0 → friendly parse error", async () => {
    const { dispatch, COMMANDS } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();
    const run = vi.fn().mockResolvedValue({});
    const fakeCommands = {
      resume: { run, format: vi.fn().mockReturnValue(""), buildOptions: COMMANDS.resume.buildOptions },
    };
    const result = await dispatch("/lp:resume 0", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);
    expect(result).toEqual({ exit: false });
    expect(run).not.toHaveBeenCalled();
    expect(getOutput()).toContain("Invalid resume index");
  });

  it("parseIndex rejects negative → friendly parse error", async () => {
    const { dispatch, COMMANDS } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();
    const run = vi.fn().mockResolvedValue({});
    const fakeCommands = {
      resume: { run, format: vi.fn().mockReturnValue(""), buildOptions: COMMANDS.resume.buildOptions },
    };
    const result = await dispatch("/lp:resume -1", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);
    expect(result).toEqual({ exit: false });
    expect(run).not.toHaveBeenCalled();
    expect(getOutput()).toContain("Invalid resume index");
  });

  it("parseIndex rejects decimal → friendly parse error", async () => {
    const { dispatch, COMMANDS } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();
    const run = vi.fn().mockResolvedValue({});
    const fakeCommands = {
      resume: { run, format: vi.fn().mockReturnValue(""), buildOptions: COMMANDS.resume.buildOptions },
    };
    const result = await dispatch("/lp:resume 2.5", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);
    expect(result).toEqual({ exit: false });
    expect(run).not.toHaveBeenCalled();
    expect(getOutput()).toContain("Invalid resume index");
  });

  it("parseIndex rejects leading-zero form → friendly parse error", async () => {
    const { dispatch, COMMANDS } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();
    const run = vi.fn().mockResolvedValue({});
    const fakeCommands = {
      resume: { run, format: vi.fn().mockReturnValue(""), buildOptions: COMMANDS.resume.buildOptions },
    };
    const result = await dispatch("/lp:resume 01", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);
    expect(result).toEqual({ exit: false });
    expect(run).not.toHaveBeenCalled();
    expect(getOutput()).toContain("Invalid resume index");
  });

  it("parseIndex rejects unsafe integer → friendly parse error", async () => {
    const { dispatch, COMMANDS } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();
    const run = vi.fn().mockResolvedValue({});
    const fakeCommands = {
      resume: { run, format: vi.fn().mockReturnValue(""), buildOptions: COMMANDS.resume.buildOptions },
    };
    const result = await dispatch("/lp:resume 9007199254740993", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);
    expect(result).toEqual({ exit: false });
    expect(run).not.toHaveBeenCalled();
    expect(getOutput()).toContain("Invalid resume index");
  });

  it("parse-error takes precedence over unknown-command: /lp:nope \"unterminated reports parse error", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output, getOutput } = makeOutput();
    const rl = makeFakeRl();

    // /lp:nope with an unterminated quote: tokenization runs first (on the /lp: path),
    // so the parse error (unbalanced quote) is reported, NOT the unknown-command message
    const result = await dispatch('/lp:nope "unterminated', { cwd: DEFAULT_CWD, rl, output }, {});
    expect(result).toEqual({ exit: false });
    expect(getOutput()).toContain("Unbalanced quote");
    expect(getOutput()).not.toContain("Unknown command");
  });

  it("/lp:context with no role → context core called with role:undefined, { exit:false }", async () => {
    const { dispatch } = await import("../../src/repl/dispatch.js");
    const { output } = makeOutput();
    const rl = makeFakeRl();

    const run = vi.fn().mockResolvedValue({});
    const format = vi.fn().mockReturnValue("context result");
    const fakeCommands = {
      context: {
        run,
        format,
        buildOptions: (tokens: string[]) => ({ role: tokens[0] }),
      },
    };

    const result = await dispatch("/lp:context", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);
    expect(result).toEqual({ exit: false });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ role: undefined }));
  });

  it("/lp:resume with no index → resume core called with index:undefined, { exit:false }", async () => {
    const { dispatch, COMMANDS } = await import("../../src/repl/dispatch.js");
    const { output } = makeOutput();
    const rl = makeFakeRl();

    const run = vi.fn().mockResolvedValue({ sessions: [], selected: undefined });
    const format = vi.fn().mockReturnValue("No sessions found");
    const fakeCommands = {
      resume: {
        run,
        format,
        buildOptions: COMMANDS.resume.buildOptions,
      },
    };

    const result = await dispatch("/lp:resume", { cwd: DEFAULT_CWD, rl, output }, fakeCommands);
    expect(result).toEqual({ exit: false });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ index: undefined }));
    // No second reader opened — rl.question was not called
  });
});
