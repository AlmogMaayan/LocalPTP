/**
 * REPL quote-aware tokenizer.
 *
 * `tokenize(input)` splits the input string on whitespace, while keeping
 * `"…"` and `'…'` spans as single tokens (with quotes stripped).
 * An unbalanced quote throws `TokenizeError`.
 *
 * Intentionally minimal: no escape sequences, no env expansion, no globbing.
 */

export class TokenizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenizeError";
  }
}

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let started = false; // distinguishes empty quoted token from no token

  for (const ch of input) {
    if (quote) {
      if (ch === quote) {
        // closing quote
        quote = null;
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      // opening quote
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) {
        tokens.push(cur);
        cur = "";
        started = false;
      }
    } else {
      cur += ch;
      started = true;
    }
  }

  if (quote) {
    throw new TokenizeError("Unbalanced quote in command.");
  }

  if (started) {
    tokens.push(cur);
  }

  return tokens;
}
