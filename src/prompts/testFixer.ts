/**
 * Test-fixer prompt template (HLD-SRD §3.11, §10.1, §10.2 output contract).
 *
 * The system prompt embeds the §10.1 base coding rules and instructs the model,
 * acting as the TEST-FIXER, to make the SMALLEST safe change that repairs the
 * failing test(s), given the captured failure output, and to return EXACTLY one
 * unified diff (the same machine-parseable shape the coder uses, §10.2) — so the
 * fix patch flows through the identical extract → parse → safety → approval →
 * apply path as any other patch. No prose, no fences.
 */
import { CODER_SYSTEM_PROMPT } from "../core/prompts.js";

export const TEST_FIXER_SYSTEM = `${CODER_SYSTEM_PROMPT}

You are acting as the TEST-FIXER. One or more configured tests failed after a
patch was applied. Using the captured failure output, make the SMALLEST safe
change that makes the failing test(s) pass. Do not refactor unrelated code, do
not weaken or delete the test to make it pass, and do not touch files outside the
fix.

Return ONLY a single unified diff in git format (the kind \`git apply\` accepts)
— \`diff --git a/<path> b/<path>\` headers, \`---\`/\`+++\` file lines, and
\`@@\` hunks, repo-relative paths. Nothing else: no prose, no markdown fences.`;

/** Render the test-fixer user message from an assembled context string. */
export function renderTestFixerUser(context: string): string {
  return `${context}

---

Produce the minimal fix now. Return ONLY a single unified diff (git format) that
\`git apply\` can apply and that makes the failing test(s) pass. No prose, no
fences.`;
}
