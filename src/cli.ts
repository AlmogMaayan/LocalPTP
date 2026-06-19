#!/usr/bin/env node
/**
 * `localcoder` CLI entry (HLD-SRD §3.1, §8).
 *
 * Registers the full MVP command surface: `init`, `config`, `doctor` are live;
 * the remaining nine are stubs that print "not implemented yet (slice 000X)"
 * and exit non-zero. Global flags: `--json`, `--debug`.
 */
import { Command } from "commander";
import { pathToFileURL, fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { runInit, formatInitReport } from "./commands/init.js";
import { runConfig, formatConfigResult } from "./commands/config.js";
import { runDoctor, formatDoctorResult } from "./commands/doctor.js";
import { runIndex, formatIndexResult } from "./commands/index.js";
import { runContext, formatContextResult } from "./commands/context.js";
import { runTask, formatTaskResult } from "./commands/task.js";
import { runPlan, formatPlanResult } from "./commands/plan.js";
import { runResume, formatResumeResult } from "./commands/resume.js";
import { runStep, formatStepResult } from "./commands/step.js";
import { run as runRun, formatRunResult } from "./commands/run.js";
import { runReview, formatReviewResult } from "./commands/review.js";
import { runSummarize, formatSummarizeResult } from "./commands/summarize.js";
import { ModelClientError } from "./types/model.js";
import { redactSecrets } from "./utils/logger.js";

/** Deferred commands and the slice that will implement each. */
export const STUB_COMMANDS: Record<string, string> = {};

interface GlobalOpts {
  json?: boolean;
  debug?: boolean;
}

function globalOpts(command: Command): GlobalOpts {
  // Walk to the root program to read global options.
  let root: Command = command;
  while (root.parent) root = root.parent;
  return root.opts() as GlobalOpts;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("localcoder")
    .description("LocalCode Orchestrator — drive a local coding model over a codebase.")
    .option("--json", "emit structured output as JSON")
    .option("--debug", "raise log verbosity")
    .enablePositionalOptions();

  // --- live commands ---

  program
    .command("init")
    .description("Scaffold /ai memory + .ai-orchestrator/config.yml (idempotent, no source edits)")
    .action(async function (this: Command) {
      const opts = globalOpts(this);
      const report = await runInit({ cwd: process.cwd(), json: opts.json });
      if (opts.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      } else {
        process.stdout.write(formatInitReport(report) + "\n");
      }
    });

  program
    .command("config")
    .description("Show the merged config, a sub-tree, or set a dotted key")
    .argument("[key]", "dotted config key or sub-tree (e.g. model.baseUrl)")
    .argument("[value]", "value to set; omit to show")
    .action(async function (this: Command, key?: string, value?: string) {
      const opts = globalOpts(this);
      const result = await runConfig({ cwd: process.cwd(), key, value, json: opts.json });
      if (opts.json) {
        process.stdout.write(JSON.stringify(result.value, null, 2) + "\n");
      } else {
        process.stdout.write(formatConfigResult(result) + "\n");
      }
    });

  program
    .command("doctor")
    .description("Verify LM Studio is reachable and the model responds")
    .action(async function (this: Command) {
      const opts = globalOpts(this);
      const result = await runDoctor({ cwd: process.cwd(), json: opts.json });
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            { reachable: result.reachable, model: result.model, latencyMs: result.latencyMs },
            null,
            2,
          ) + "\n",
        );
      } else {
        process.stdout.write(formatDoctorResult(result) + "\n");
      }
    });

  program
    .command("index")
    .description("Scan the repo and write .ai-orchestrator/index.json + update /ai memory map files")
    .action(async function (this: Command) {
      const opts = globalOpts(this);
      const result = await runIndex({ cwd: process.cwd(), json: opts.json });
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            { indexed: result.indexed, ignored: result.ignored, durationMs: result.durationMs },
            null,
            2,
          ) + "\n",
        );
      } else {
        process.stdout.write(formatIndexResult(result) + "\n");
      }
    });

  program
    .command("context")
    .description("Preview the context package for a role (read-only; no model call)")
    .option("--role <role>", "agent role to preview (default: coder)")
    .action(async function (this: Command) {
      const opts = globalOpts(this);
      const local = this.opts() as { role?: string };
      const result = await runContext({
        cwd: process.cwd(),
        role: local.role,
        json: opts.json,
      });
      if (opts.json) {
        process.stdout.write(JSON.stringify(result.pkg, null, 2) + "\n");
      } else {
        process.stdout.write(formatContextResult(result) + "\n");
      }
    });

  program
    .command("task")
    .description("Create a scoped task + session and mark them active")
    .argument("<text>", "the task description")
    .action(async function (this: Command, text: string) {
      const opts = globalOpts(this);
      const result = await runTask({ cwd: process.cwd(), text, json: opts.json });
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        process.stdout.write(formatTaskResult(result) + "\n");
      }
    });

  program
    .command("plan")
    .description("Decompose the active task into ordered subtasks (calls the model)")
    .action(async function (this: Command) {
      const opts = globalOpts(this);
      const result = await runPlan({ cwd: process.cwd(), json: opts.json });
      if (opts.json) {
        // --json: only the validated plan on stdout (human summary suppressed).
        process.stdout.write(JSON.stringify(result.plan, null, 2) + "\n");
      } else {
        process.stdout.write(formatPlanResult(result) + "\n");
      }
    });

  program
    .command("resume")
    .description("List past sessions and continue from a selected one")
    .argument("[index]", "1-based index of the session to resume")
    .action(async function (this: Command, index?: string) {
      const opts = globalOpts(this);
      const parsed =
        index !== undefined && index.trim().length > 0
          ? Number(index)
          : undefined;
      const result = await runResume({
        cwd: process.cwd(),
        index: parsed,
        json: opts.json,
      });
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            {
              sessions: result.sessions.map((s) => ({
                path: s.path,
                status: s.status,
                nextStep: s.nextStep,
              })),
              selected: result.selected?.path,
            },
            null,
            2,
          ) + "\n",
        );
      } else {
        process.stdout.write(formatResumeResult(result) + "\n");
      }
    });

  program
    .command("step")
    .description(
      "Run the next pending subtask: model → diff → safety gates → approval → apply → tests",
    )
    .action(async function (this: Command) {
      const opts = globalOpts(this);
      const result = await runStep({ cwd: process.cwd(), json: opts.json });
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            {
              applied: result.applied,
              done: result.done,
              subtaskId: result.subtaskId,
              patchPath: result.patchPath,
              needsContext: result.needsContext,
              testResults: result.testResults,
            },
            null,
            2,
          ) + "\n",
        );
      } else {
        process.stdout.write(formatStepResult(result) + "\n");
      }
    });

  program
    .command("run")
    .description(
      "Loop the step cycle over pending subtasks with approval checkpoints until a stop condition",
    )
    .action(async function (this: Command) {
      const opts = globalOpts(this);
      const result = await runRun({ cwd: process.cwd(), json: opts.json });
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            {
              stopReason: result.stopReason,
              applied: result.applied,
              iterations: result.iterations,
            },
            null,
            2,
          ) + "\n",
        );
      } else {
        process.stdout.write(formatRunResult(result) + "\n");
      }
    });

  program
    .command("review")
    .description("Review the current Git diff with the model (advisory; modifies nothing)")
    .action(async function (this: Command) {
      const opts = globalOpts(this);
      const result = await runReview({ cwd: process.cwd(), json: opts.json });
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            { hadChanges: result.hadChanges, report: result.report, raw: result.raw },
            null,
            2,
          ) + "\n",
        );
      } else {
        process.stdout.write(formatReviewResult(result) + "\n");
      }
    });

  program
    .command("summarize")
    .description("Summarize the session and update /ai memory files (closes the daily loop)")
    .action(async function (this: Command) {
      const opts = globalOpts(this);
      const result = await runSummarize({ cwd: process.cwd(), json: opts.json });
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            {
              session: { path: result.session.path, status: result.session.status },
              updatedFiles: result.updatedFiles,
              ignored: result.ignored,
            },
            null,
            2,
          ) + "\n",
        );
      } else {
        process.stdout.write(formatSummarizeResult(result) + "\n");
      }
    });

  // --- stub commands ---

  for (const [name, slice] of Object.entries(STUB_COMMANDS)) {
    program
      .command(name)
      .description(`(not implemented yet — slice ${slice})`)
      .allowExcessArguments(true)
      .allowUnknownOption(true)
      .action(() => {
        console.error(`${name}: not implemented yet (slice ${slice})`);
        const err = new Error(`not implemented: ${name}`) as Error & {
          exitCode: number;
        };
        err.exitCode = 1;
        throw err;
      });
  }

  return program;
}

/** Map an error to a user-facing message + exit code. */
function reportError(err: unknown): number {
  if (err instanceof ModelClientError) {
    // baseUrl may carry credentials (user:pass@host) — redact before stderr.
    console.error(redactSecrets(err.message));
    return 1;
  }
  if (err instanceof Error) {
    const code = (err as { exitCode?: number }).exitCode;
    // Stub errors print their own message before throwing (a generic `Error`
    // named "Error" carrying an exitCode); everything else still needs its
    // message surfaced to stderr — including the Patch Manager refusals
    // (PatchValidationError / PatchApplyError / WorkingTreeUnsafeError), whose
    // reason must reach the user, not just a bare non-zero exit.
    const isSelfPrintedStub = code !== undefined && err.name === "Error";
    if (!isSelfPrintedStub) {
      console.error(redactSecrets(err.message));
    }
    return typeof code === "number" ? code : 1;
  }
  console.error(redactSecrets(String(err)));
  return 1;
}

export async function main(argv: string[]): Promise<number> {
  const program = buildProgram();
  program.exitOverride();
  try {
    await program.parseAsync(argv);
    return 0;
  } catch (err) {
    // commander's help/version exits surface as CommanderError with exitCode 0.
    const commanderCode = (err as { exitCode?: number; code?: string }).code;
    if (
      commanderCode === "commander.helpDisplayed" ||
      commanderCode === "commander.version" ||
      commanderCode === "commander.help"
    ) {
      return (err as { exitCode?: number }).exitCode ?? 0;
    }
    return reportError(err);
  }
}

// Only run when invoked directly (not when imported by tests). Compare RESOLVED
// real paths: when installed via the npm `bin`, `process.argv[1]` is a symlink
// (e.g. node_modules/.bin/localcoder) while `import.meta.url` is realpath-
// resolved — a raw string compare would miss and the CLI would silently no-op.
// Falls back to the unresolved compare if realpath fails (e.g. file removed).
function isDirectRun(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(modulePath) === realpathSync(argv1);
  } catch {
    return import.meta.url === pathToFileURL(argv1).href;
  }
}

if (isDirectRun()) {
  main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
