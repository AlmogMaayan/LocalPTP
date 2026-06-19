/**
 * Summarizer prompt template (HLD-SRD §3.9, §10.1, 0001_07).
 *
 * The system prompt embeds the §10.1 base coding rules and instructs the model
 * to summarize the just-finished work. The user framing wraps the Context
 * Builder's assembled context and demands ONLY the §3.9 summarizer JSON
 * object.
 *
 * Key constraints (§3.4, §13):
 *   - The model MUST declare changeType from the ONLY allowed set.
 *   - The code (not the model) picks the target file from the policy table.
 *   - One concise line per entry.
 */
import { CODER_SYSTEM_PROMPT } from "../core/prompts.js";

export const SUMMARIZER_SYSTEM = `${CODER_SYSTEM_PROMPT}

You are acting as the SUMMARIZER. Review the work done in this session and
produce a compact, structured summary for memory updates.

Return ONLY a single JSON object — no prose, no markdown fences — with this shape:

{
  "sessionUpdate": {
    "currentState": "one concise paragraph of what was accomplished",
    "filesChanged": ["list", "of", "files", "touched"],
    "decisions": ["brief decision taken"],
    "risks": ["brief risk or open issue"]
  },
  "memoryUpdates": [
    {
      "changeType": "<ONLY one of the allowed types listed below>",
      "content": "one concise line describing the change"
    }
  ],
  "nextStep": "the single most important next action"
}

Allowed changeType values (ONLY these — the system uses this to determine which
memory file to update; you must NOT specify a file name):
  - file-responsibility   → file ownership / responsibility changes
  - api-behavior          → API contract or endpoint behavior changes
  - data-model            → data structure or schema changes
  - architectural-decision → significant design decisions
  - external-integration  → third-party or external service integration changes
  - testing-process       → testing strategy or process changes
  - risk                  → risks, bugs found, or known issues

Rules:
- Keep every entry CONCISE — one brief line per memoryUpdates entry.
- Omit empty arrays (include only what applies).
- Do NOT include a changeType outside the allowed list above.
- Do NOT suggest a file path in your response.
- If no Git diff is present, summarize task/session progress only.`;

/** Render the summarizer user message from an assembled context string. */
export function renderSummarizerUser(context: string): string {
  return `${context}

---

Produce the summary now. Return ONLY the JSON object with these keys:
sessionUpdate (currentState, filesChanged[], decisions[], risks[]),
memoryUpdates (each with changeType and content — use ONLY the allowed change types),
nextStep.`;
}
