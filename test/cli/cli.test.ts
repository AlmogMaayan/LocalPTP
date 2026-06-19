import { describe, it, expect } from "vitest";
import { buildProgram, STUB_COMMANDS } from "../../src/cli.js";

function captureProgram() {
  const program = buildProgram();
  program.exitOverride(); // throw instead of process.exit
  let out = "";
  let err = "";
  program.configureOutput({
    writeOut: (s) => (out += s),
    writeErr: (s) => (err += s),
  });
  return { program, getOut: () => out, getErr: () => err };
}

describe("CLI command surface", () => {
  it("7.1 --help lists all 12 commands", async () => {
    const { program, getOut } = captureProgram();
    try {
      await program.parseAsync(["node", "localcoder", "--help"]);
    } catch {
      // commander throws on --help under exitOverride
    }
    const help = getOut();
    for (const name of [
      "init",
      "config",
      "doctor",
      "index",
      "task",
      "plan",
      "context",
      "step",
      "run",
      "review",
      "summarize",
      "resume",
    ]) {
      expect(help).toContain(name);
    }
  });

  it("7.1 the stub map is now empty — all 12 commands are live (0001_07)", () => {
    // All commands including summarize are now live (slice 0001_07 complete).
    expect(STUB_COMMANDS.index).toBeUndefined();
    expect(STUB_COMMANDS.context).toBeUndefined();
    expect(STUB_COMMANDS.task).toBeUndefined();
    expect(STUB_COMMANDS.plan).toBeUndefined();
    expect(STUB_COMMANDS.resume).toBeUndefined();
    expect(STUB_COMMANDS.step).toBeUndefined();
    expect(STUB_COMMANDS.run).toBeUndefined();
    expect(STUB_COMMANDS.review).toBeUndefined();
    // summarize is now live — not in stubs.
    expect(STUB_COMMANDS.summarize).toBeUndefined();
    expect(Object.keys(STUB_COMMANDS)).toHaveLength(0);
  });
});
