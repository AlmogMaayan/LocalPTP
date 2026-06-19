/**
 * Prompt Manager seam (HLD-SRD §3.9).
 *
 * `getPrompt(role)` returns the role's `{ system, renderUser }` pair. The
 * `planner`, `coder`, `reviewer`, and `test-fixer` roles are registered; the
 * retriever role is out for the whole MVP. Requesting an unregistered role
 * throws so callers fail loudly rather than silently using a wrong prompt.
 */
import type { AgentRole } from "../types/model.js";
import { PLANNER_SYSTEM, renderPlannerUser } from "../prompts/planner.js";
import { CODER_SYSTEM, renderCoderUser } from "../prompts/coder.js";
import { REVIEWER_SYSTEM, renderReviewerUser } from "../prompts/reviewer.js";
import { TEST_FIXER_SYSTEM, renderTestFixerUser } from "../prompts/testFixer.js";
import { SUMMARIZER_SYSTEM, renderSummarizerUser } from "../prompts/summarizer.js";

export interface RolePrompt {
  /** The static system prompt for the role. */
  system: string;
  /** Render the user message from the Context Builder's assembled context. */
  renderUser(context: string): string;
}

const REGISTRY: Partial<Record<AgentRole, RolePrompt>> = {
  planner: {
    system: PLANNER_SYSTEM,
    renderUser: renderPlannerUser,
  },
  coder: {
    system: CODER_SYSTEM,
    renderUser: renderCoderUser,
  },
  reviewer: {
    system: REVIEWER_SYSTEM,
    renderUser: renderReviewerUser,
  },
  "test-fixer": {
    system: TEST_FIXER_SYSTEM,
    renderUser: renderTestFixerUser,
  },
  summarizer: {
    system: SUMMARIZER_SYSTEM,
    renderUser: renderSummarizerUser,
  },
};

export function getPrompt(role: AgentRole): RolePrompt {
  const prompt = REGISTRY[role];
  if (prompt === undefined) {
    throw new Error(
      `No prompt registered for role "${role}". The retriever role is out for the MVP.`,
    );
  }
  return prompt;
}
