/**
 * REPL command dispatcher (HLD-SRD § interactive-repl).
 *
 * `dispatch(line, ctx, commands)` handles every `/`-prefixed line from the
 * REPL loop:
 *   - Meta (bare `/help` | `/exit` | `/clear`): built-in handlers.
 *   - `/lp:<cmd> [args]`: look up `<cmd>` in the COMMANDS table, map tokens
 *     to options via `buildOptions`, call the core `run`, write `format` output.
 *   - Unknown bare `/…` or unknown `/lp:<cmd>`: friendly message.
 *   - Any throw (TokenizeError, parse error, core error): friendly message,
 *     loop survives.
 *
 * The third `commands` parameter (defaulting to the production `COMMANDS`) is
 * the concrete test seam: tests pass a fake table of vi.fn() entries to avoid
 * importing or executing any real core.
 */
import type readline from "node:readline";
import { tokenize, TokenizeError } from "./tokenize.js";
import { replApprover } from "./approver.js";
import { runTask, formatTaskResult } from "../commands/task.js";
import { runPlan, formatPlanResult } from "../commands/plan.js";
import { runStep, formatStepResult } from "../commands/step.js";
import { run as runRun, formatRunResult } from "../commands/run.js";
import { runIndex, formatIndexResult } from "../commands/index.js";
import { runContext, formatContextResult } from "../commands/context.js";
import { runResume, formatResumeResult } from "../commands/resume.js";
import { runReview, formatReviewResult } from "../commands/review.js";
import { runSummarize, formatSummarizeResult } from "../commands/summarize.js";
import { runInit, formatInitReport } from "../commands/init.js";
import { runConfig, formatConfigResult } from "../commands/config.js";
import { runDoctor, formatDoctorResult } from "../commands/doctor.js";

export interface DispatchCtx {
  cwd: string;
  rl: readline.Interface;
  output: NodeJS.WritableStream;
}

export interface DispatchResult {
  exit: boolean;
}

interface CommandEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (opts: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  format: (result: any) => string;
  buildOptions: (tokens: string[], ctx: DispatchCtx) => Record<string, unknown>;
}

const UNKNOWN_MSG = "Unknown command. Type /help for commands.";
const LP_PREFIX = "/lp:";

/**
 * Validate and parse a resume index token.
 *
 * Accepts only canonical positive-integer syntax (no leading zeros, no
 * decimals, no unsafe/overflowing integers). An invalid value throws a
 * `TokenizeError` (caught by the dispatch try/catch) rather than forwarding
 * a NaN or wrong value to `runResume`.
 *
 * When `tok` is `undefined` (i.e., the user omitted the index), returns
 * `undefined` — this is NOT an error; the resume core handles the missing index
 * with its own semantics (listing sessions, guidance, etc.).
 */
function parseIndex(tok: string | undefined): number | undefined {
  if (tok === undefined) return undefined;
  const n = Number(tok);
  if (!/^[1-9]\d*$/.test(tok) || !Number.isSafeInteger(n)) {
    throw new TokenizeError(`Invalid resume index: ${tok} (expected a positive integer).`);
  }
  return n;
}

/**
 * The production COMMANDS table.
 *
 * Exported so tests can assert identity (`COMMANDS.plan.run === runPlan`) and
 * inspect `buildOptions` mappings directly.
 */
export const COMMANDS: Record<string, CommandEntry> = {
  task: {
    run: runTask,
    format: formatTaskResult,
    buildOptions: (tokens) => ({ text: tokens.join(" ") }),
  },
  plan: {
    run: runPlan,
    format: formatPlanResult,
    buildOptions: () => ({}),
  },
  step: {
    run: runStep,
    format: formatStepResult,
    buildOptions: (_tokens, ctx) => ({ approve: replApprover(ctx.rl) }),
  },
  run: {
    run: runRun,
    format: formatRunResult,
    buildOptions: (_tokens, ctx) => ({ approve: replApprover(ctx.rl) }),
  },
  index: {
    run: runIndex,
    format: formatIndexResult,
    buildOptions: () => ({}),
  },
  context: {
    run: runContext,
    format: formatContextResult,
    buildOptions: (tokens) => ({ role: tokens[0] }),
  },
  resume: {
    run: runResume,
    format: formatResumeResult,
    buildOptions: (tokens) => ({ index: parseIndex(tokens[0]) }),
  },
  review: {
    run: runReview,
    format: formatReviewResult,
    buildOptions: () => ({}),
  },
  summarize: {
    run: runSummarize,
    format: formatSummarizeResult,
    buildOptions: () => ({}),
  },
  init: {
    run: runInit,
    format: formatInitReport,
    buildOptions: () => ({}),
  },
  config: {
    run: runConfig,
    format: formatConfigResult,
    buildOptions: (tokens) => ({ key: tokens[0], value: tokens[1] }),
  },
  doctor: {
    run: runDoctor,
    format: formatDoctorResult,
    buildOptions: () => ({}),
  },
};

/**
 * Dispatch a `/`-prefixed REPL line.
 *
 * @param line     The raw input line (should start with `/`).
 * @param ctx      Context: `cwd`, the open `rl` interface, and the `output` stream.
 * @param commands The command table (defaults to the production `COMMANDS`).
 *                 Override in tests with a fake table to avoid real cores.
 * @returns `{ exit: true }` only for `/exit`; `{ exit: false }` for everything else.
 */
export async function dispatch(
  line: string,
  ctx: DispatchCtx,
  commands: Record<string, CommandEntry> = COMMANDS,
): Promise<DispatchResult> {
  const trimmed = line.trim();

  // ── Meta branch (bare `/…`, not `/lp:`) ─────────────────────────────────
  // Meta lines are matched on the whole trimmed line — they are NOT tokenized,
  // so an unbalanced quote in a bare `/…` line is just an unknown command, not
  // a parse error.
  if (!trimmed.startsWith(LP_PREFIX)) {
    if (trimmed === "/help") {
      const lpLines = Object.keys(commands).map((name) => `  /lp:${name}`);
      const metaLines = ["  /help", "  /exit", "  /clear"];
      ctx.output.write(["Available commands:", ...lpLines, ...metaLines].join("\n") + "\n");
      return { exit: false };
    }
    if (trimmed === "/exit") {
      return { exit: true };
    }
    if (trimmed === "/clear") {
      ctx.output.write("\x1b[2J\x1b[H");
      return { exit: false };
    }
    // Unknown bare slash command.
    ctx.output.write(UNKNOWN_MSG + "\n");
    return { exit: false };
  }

  // ── /lp:<cmd> branch ────────────────────────────────────────────────────
  // A single try/catch wraps tokenize, lookup, buildOptions (may throw, e.g.
  // parseIndex), the core run, and format — so anything that throws is caught
  // and the loop survives.
  try {
    const remainder = trimmed.slice(LP_PREFIX.length); // everything after "/lp:"
    const [cmd, ...rest] = tokenize(remainder);

    // Empty /lp: or whitespace-only → cmd is undefined.
    // Use Object.hasOwn so prototype members (constructor, toString, __proto__)
    // are never treated as commands.
    if (!cmd || !Object.hasOwn(commands, cmd)) {
      ctx.output.write(UNKNOWN_MSG + "\n");
      return { exit: false };
    }

    const entry = commands[cmd];
    // buildOptions is inside the try so parseIndex errors are caught here.
    const opts = { cwd: ctx.cwd, ...entry.buildOptions(rest, ctx) };
    const result = await entry.run(opts as Record<string, unknown>);
    ctx.output.write(entry.format(result) + "\n");
  } catch (e) {
    ctx.output.write((e instanceof Error ? e.message : String(e)) + "\n");
  }

  return { exit: false };
}
