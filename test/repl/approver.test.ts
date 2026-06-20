/**
 * Tests for `replApprover` — a REPL-aware Approver that reuses the loop's
 * readline.Interface instead of opening a second one on the same stdin.
 */
import { describe, it, expect } from "vitest";
import type { Interface as RlInterface } from "node:readline";
import { replApprover } from "../../src/repl/approver.js";

/**
 * Creates a fake readline.Interface that records the prompt string and
 * immediately invokes `question`'s callback with a canned answer.
 *
 * Includes `once` and `removeListener` so `replApprover` (which registers a
 * close handler) works without errors.
 */
function makeFakeRl(cannedAnswer: string): {
  rl: Pick<RlInterface, "question" | "once" | "removeListener">;
  getLastQuestion: () => string | undefined;
} {
  let lastQuestion: string | undefined;
  const rl = {
    question(q: string, cb: (answer: string) => void) {
      lastQuestion = q;
      cb(cannedAnswer);
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    once(_event: string, _handler: () => void) {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    removeListener(_event: string, _handler: () => void) {},
  };
  return { rl: rl as unknown as RlInterface, getLastQuestion: () => lastQuestion };
}

describe("replApprover", () => {
  it("resolves true for 'y'", async () => {
    const { rl } = makeFakeRl("y");
    const approver = replApprover(rl as RlInterface);
    expect(await approver("Proceed?")).toBe(true);
  });

  it("resolves true for 'Y' (uppercase)", async () => {
    const { rl } = makeFakeRl("Y");
    const approver = replApprover(rl as RlInterface);
    expect(await approver("Proceed?")).toBe(true);
  });

  it("resolves true for 'yes'", async () => {
    const { rl } = makeFakeRl("yes");
    const approver = replApprover(rl as RlInterface);
    expect(await approver("Proceed?")).toBe(true);
  });

  it("resolves true for 'YES' (uppercase)", async () => {
    const { rl } = makeFakeRl("YES");
    const approver = replApprover(rl as RlInterface);
    expect(await approver("Proceed?")).toBe(true);
  });

  it("resolves true for '  yes  ' (surrounding whitespace)", async () => {
    const { rl } = makeFakeRl("  yes  ");
    const approver = replApprover(rl as RlInterface);
    expect(await approver("Proceed?")).toBe(true);
  });

  it("resolves false for 'n'", async () => {
    const { rl } = makeFakeRl("n");
    const approver = replApprover(rl as RlInterface);
    expect(await approver("Proceed?")).toBe(false);
  });

  it("resolves false for empty string ''", async () => {
    const { rl } = makeFakeRl("");
    const approver = replApprover(rl as RlInterface);
    expect(await approver("Proceed?")).toBe(false);
  });

  it("resolves false for 'maybe'", async () => {
    const { rl } = makeFakeRl("maybe");
    const approver = replApprover(rl as RlInterface);
    expect(await approver("Proceed?")).toBe(false);
  });

  it("passes the prompt with [y/N] suffix to rl.question", async () => {
    const { rl, getLastQuestion } = makeFakeRl("y");
    const approver = replApprover(rl as RlInterface);
    await approver("Delete file?");
    expect(getLastQuestion()).toBe("Delete file? [y/N] ");
  });
});
