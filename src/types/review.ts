/**
 * Review report type + schema (HLD-SRD §3.12; 0001_06).
 *
 * The advisory `review` command asks the model for a structured report and
 * tolerantly extracts it. The schema mirrors the §3.12 shape; every array
 * defaults to `[]` and the two strings default to `""` so a partial or
 * key-light model response still validates into a complete, printable report.
 * Array members that are not strings are dropped (tolerant of local-model noise).
 */
import { z } from "zod";

/** A string-array field that tolerantly drops non-string members and defaults []. */
const stringArray = z
  .array(z.unknown())
  .transform((arr) => arr.filter((x): x is string => typeof x === "string"))
  .default([]);

export const reviewReportSchema = z.object({
  summary: z.string().default(""),
  blocking: stringArray,
  nonBlocking: stringArray,
  missingTests: stringArray,
  scopeCreep: stringArray,
  recommendation: z.string().default(""),
});

export type ReviewReport = z.infer<typeof reviewReportSchema>;
