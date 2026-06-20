/**
 * Tests for `tokenize` — the REPL's quote-aware argument tokenizer.
 */
import { describe, it, expect } from "vitest";
import { tokenize, TokenizeError } from "../../src/repl/tokenize.js";

describe("tokenize", () => {
  it("splits bare words on whitespace", () => {
    expect(tokenize("task foo")).toEqual(["task", "foo"]);
  });

  it("double-quoted span is kept as one token (quotes stripped)", () => {
    expect(tokenize('task "Add severity levels"')).toEqual(["task", "Add severity levels"]);
  });

  it("single-quoted span is kept as one token (quotes stripped)", () => {
    expect(tokenize("task 'Add severity levels'")).toEqual(["task", "Add severity levels"]);
  });

  it("empty double-quoted token is kept", () => {
    expect(tokenize('a ""')).toEqual(["a", ""]);
  });

  it("empty single-quoted token is kept", () => {
    expect(tokenize("a ''")).toEqual(["a", ""]);
  });

  it("unbalanced double quote throws TokenizeError", () => {
    expect(() => tokenize('task "Add')).toThrow(TokenizeError);
  });

  it("unbalanced single quote throws TokenizeError", () => {
    expect(() => tokenize("task 'Add")).toThrow(TokenizeError);
  });

  it("empty string returns empty array", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("whitespace-only returns empty array", () => {
    expect(tokenize("   ")).toEqual([]);
  });

  it("multiple tokens", () => {
    expect(tokenize("config model.baseUrl http://x")).toEqual([
      "config",
      "model.baseUrl",
      "http://x",
    ]);
  });
});
