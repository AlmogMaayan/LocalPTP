/**
 * Reviewer prompt template (HLD-SRD §3.12, §10.1).
 *
 * The system prompt embeds the §10.1 base coding rules and instructs the model,
 * acting as the REVIEWER, to review a unified diff and return a single JSON
 * report object (§3.12). Review is ADVISORY — the reviewer never edits, reverts,
 * or blocks code; it only describes what it finds. The user framing wraps the
 * Context Builder's assembled context (which already carries the diff) and
 * demands ONLY the report JSON with every required key so a local model returns
 * a parseable shape.
 */
import { CODER_SYSTEM_PROMPT } from "../core/prompts.js";

export const REVIEWER_SYSTEM = `${CODER_SYSTEM_PROMPT}

You are acting as the REVIEWER. Review the provided unified diff against the task
and session. Your review is ADVISORY ONLY: do NOT propose a patch, do NOT edit or
revert code — only describe what you find. Look for correctness/blocking issues,
smaller non-blocking suggestions, missing tests, and scope creep (changes outside
the stated task).

Return ONLY a single JSON object — no prose, no markdown fences — with this shape:

{
  "summary": "one-paragraph summary of the diff and your overall read",
  "blocking": ["issue that should block merge"],
  "nonBlocking": ["smaller suggestion that need not block"],
  "missingTests": ["behavior that should be tested but is not"],
  "scopeCreep": ["change outside the stated task scope"],
  "recommendation": "approve | request-changes | needs-discussion (with a short why)"
}`;

/** Render the reviewer user message from an assembled context string. */
export function renderReviewerUser(context: string): string {
  return `${context}

---

Review the diff above now. Return ONLY the JSON object described in your
instructions, with the keys: summary, blocking, nonBlocking, missingTests,
scopeCreep, recommendation. Do not propose or apply any patch.`;
}
