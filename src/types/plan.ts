/**
 * Planner output schema (HLD-SRD §3.9).
 *
 * The model is asked to return `{ summary, subtasks[…], risks, questions }`.
 * The schema is strict on shape (a subtask MUST carry a `title`; at least one
 * subtask is required) but tolerant on optional fields (defaults fill omitted
 * `description`/`likelyFiles`/`acceptanceCriteria`/`risks`/`questions`). The
 * subtask `id` and `risk` are validated loosely here and normalized after
 * parse (id → `step-N`, risk → `low|medium|high`).
 */
import { z } from "zod";

export const plannerSubtaskSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  description: z.string().default(""),
  // Normalized post-parse to low|medium|high (default medium).
  risk: z.string().optional(),
  likelyFiles: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
});

export const plannerSchema = z.object({
  summary: z.string(),
  subtasks: z.array(plannerSubtaskSchema).min(1),
  risks: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
});

export type PlannerPlan = z.infer<typeof plannerSchema>;
export type PlannerSubtask = z.infer<typeof plannerSubtaskSchema>;
