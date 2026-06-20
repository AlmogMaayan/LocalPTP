/**
 * `localptp init` (HLD-SRD §3.4, §15 Test 1).
 *
 * Detect repo root (warn, don't fail, if no `.git`) → ensure dirs → Memory
 * scaffold (write-if-absent) → write default config if absent → append the
 * marker-guarded `.gitignore` stanza → return a created/preserved report.
 * NEVER touches files outside `/ai`, `.ai-orchestrator`, and `.gitignore`.
 */
import { layout } from "../utils/paths.js";
import { detectGitRoot } from "../utils/gitRoot.js";
import { appendGitignoreStanza } from "../utils/fs.js";
import { MemoryManager, type ScaffoldReport } from "../core/memoryManager.js";
import { ConfigManager } from "../core/configManager.js";

export interface InitOptions {
  cwd: string;
  json?: boolean;
}

export interface InitReport {
  root: string;
  isGitRepo: boolean;
  memory: ScaffoldReport;
  configCreated: boolean;
  gitignoreAppended: boolean;
  warnings: string[];
}

export async function runInit(opts: InitOptions): Promise<InitReport> {
  const warnings: string[] = [];
  const git = await detectGitRoot(opts.cwd);
  if (!git.isRepo) {
    warnings.push(
      "This directory is not a Git repository. localptp will still scaffold, " +
        "but Git-dependent safety features require a repo.",
    );
  }
  const root = git.root ?? opts.cwd;
  const l = layout(root);

  const memory = await new MemoryManager(l).scaffold();
  const configCreated = await new ConfigManager(l.configFile).writeDefaultIfAbsent();
  const gitignoreAppended = await appendGitignoreStanza(l.gitignoreFile);

  return {
    root,
    isGitRepo: git.isRepo,
    memory,
    configCreated,
    gitignoreAppended,
    warnings,
  };
}

export function formatInitReport(report: InitReport): string {
  const lines: string[] = [];
  for (const w of report.warnings) {
    lines.push(`warning: ${w}`);
  }
  lines.push(`Scaffolded localptp memory at ${report.root}`);
  lines.push(
    `  memory files: ${report.memory.created.length} created, ${report.memory.preserved.length} preserved`,
  );
  lines.push(
    `  config.yml: ${report.configCreated ? "created" : "preserved"}`,
  );
  lines.push(
    `  .gitignore stanza: ${report.gitignoreAppended ? "appended" : "already present"}`,
  );
  return lines.join("\n");
}
