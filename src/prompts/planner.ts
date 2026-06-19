/**
 * Planner prompt template (HLD-SRD §3.9, §10.1).
 *
 * The system prompt embeds the §10.1 base coding rules and instructs the model
 * to decompose the task into ordered subtasks. The user framing wraps the
 * Context Builder's assembled context and demands ONLY the §3.9 planner JSON
 * object — listing every required key so a local model returns a parseable shape.
 */
import { CODER_SYSTEM_PROMPT } from "../core/prompts.js";

export const PLANNER_SYSTEM = `${CODER_SYSTEM_PROMPT}

You are acting as the PLANNER. Decompose the user's task into a small, ordered
list of concrete subtasks that a coding model can execute one at a time. Order
subtasks by dependency. Prefer the smallest safe decomposition. Mark risky
subtasks (migrations, auth, billing, deletes, config) with a higher risk level.

Return ONLY a single JSON object — no prose, no markdown fences — with this shape:

{
  "summary": "one-paragraph plan summary",
  "subtasks": [
    {
      "id": "step-1",
      "title": "short imperative title",
      "description": "what to do and why",
      "risk": "low|medium|high",
      "likelyFiles": ["path/one.ts"],
      "acceptanceCriteria": ["observable done condition"]
    }
  ],
  "risks": ["overall risk note"],
  "questions": ["open question for the user"]
}`;

/** Render the planner user message from an assembled context string. */
export function renderPlannerUser(context: string): string {
  return `${context}

---

Produce the plan now. Return ONLY the JSON object described in your
instructions, with the keys: summary, subtasks (each with id, title,
description, risk, likelyFiles, acceptanceCriteria), risks, questions.`;
}
