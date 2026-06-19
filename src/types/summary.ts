/**
 * Summarizer output schema (HLD-SRD §3.9, 0001_07).
 *
 * The model is asked to return:
 *   { sessionUpdate{currentState, filesChanged[], decisions[], risks[]},
 *     memoryUpdates[{changeType, content}],
 *     nextStep }
 *
 * All fields use defaults so a partial response still yields a usable object.
 */
import { z } from "zod";

export const summarizerSchema = z.object({
  sessionUpdate: z
    .object({
      currentState: z.string().default(""),
      filesChanged: z.array(z.string()).default([]),
      decisions: z.array(z.string()).default([]),
      risks: z.array(z.string()).default([]),
    })
    .default({}),
  memoryUpdates: z
    .array(z.object({ changeType: z.string(), content: z.string() }))
    .default([]),
  nextStep: z.string().default(""),
});

export type SummarizerOutput = z.infer<typeof summarizerSchema>;
