/**
 * Tolerant planner JSON extraction (HLD-SRD §3.9, §11.2).
 *
 * Local models routinely wrap JSON in prose or code fences. The pipeline is:
 *   1. strict `JSON.parse(raw)` of the whole response;
 *   2. else extract the FIRST balanced `{...}` block (string/escape aware) and
 *      parse that — if it fails to parse or validate, the response is treated as
 *      unparseable (no later candidates are tried, per the spec);
 *   3. validate against `plannerSchema` (defaults fill omitted optionals);
 *   4. normalize subtask ids to `step-N` and risk to `low|medium|high`.
 *
 * Any total failure throws `UnparseablePlanError`, which the `plan` command maps
 * to the §11.2 stop (clear message, nothing saved, non-zero exit).
 */
import { plannerSchema } from "../types/plan.js";
import type { Risk } from "../types/task.js";

export class UnparseablePlanError extends Error {
  constructor(message = "Could not parse a valid plan from the model output.") {
    super(message);
    this.name = "UnparseablePlanError";
  }
}

export interface NormalizedSubtask {
  id: string;
  title: string;
  description: string;
  risk: Risk;
  likelyFiles: string[];
  acceptanceCriteria: string[];
}

export interface NormalizedPlan {
  summary: string;
  subtasks: NormalizedSubtask[];
  risks: string[];
  questions: string[];
}

const RISK_VALUES: Risk[] = ["low", "medium", "high"];

function normalizeRisk(raw: string | undefined): Risk {
  const v = (raw ?? "").trim().toLowerCase();
  return (RISK_VALUES as string[]).includes(v) ? (v as Risk) : "medium";
}

/**
 * Find the first balanced `{...}` substring, tracking string state and escape
 * characters so braces inside strings do not unbalance the count. Returns the
 * substring (including the outer braces) or undefined when none is balanced.
 */
function firstBalancedObject(raw: string): string | undefined {
  const start = raw.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

/** Extract a JSON object from the raw model output, tolerant of fences/prose. */
function extractObject(raw: string): unknown {
  // 1. Strict whole-output parse.
  try {
    const obj = JSON.parse(raw);
    if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
      return obj;
    }
  } catch {
    // fall through to balanced extraction
  }
  // 2. First balanced {...} block.
  const block = firstBalancedObject(raw);
  if (block === undefined) {
    throw new UnparseablePlanError();
  }
  try {
    return JSON.parse(block);
  } catch {
    throw new UnparseablePlanError();
  }
}

/**
 * Extract, validate, and normalize the planner plan from raw model output.
 * Throws `UnparseablePlanError` on any failure.
 */
export function extractAndValidatePlannerJson(raw: string): NormalizedPlan {
  const obj = extractObject(raw);

  const result = plannerSchema.safeParse(obj);
  if (!result.success) {
    throw new UnparseablePlanError();
  }
  const plan = result.data;

  const subtasks: NormalizedSubtask[] = plan.subtasks.map((s, i) => ({
    id: `step-${i + 1}`,
    title: s.title,
    description: s.description,
    risk: normalizeRisk(s.risk),
    likelyFiles: s.likelyFiles,
    acceptanceCriteria: s.acceptanceCriteria,
  }));

  return {
    summary: plan.summary,
    subtasks,
    risks: plan.risks,
    questions: plan.questions,
  };
}
