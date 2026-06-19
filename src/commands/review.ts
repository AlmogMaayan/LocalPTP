/**
 * `localcoder review` (HLD-SRD §3.12; 0001_06).
 *
 * Advisory diff review: build a reviewer context over the current Git diff, ask
 * the model to review it, tolerantly parse the structured report (summary /
 * blocking / non-blocking / missing tests / scope creep / recommendation) and
 * print it — falling back to the raw output on a parse failure. It MODIFIES NO
 * CODE: it never edits, reverts, or applies anything.
 *
 * Exit behavior:
 *   - empty diff → "No changes to review", exit 0;
 *   - a §12 ModelClientError propagates (the CLI maps it to a non-zero exit with
 *     the connectivity guidance).
 */
import { LmStudioClient } from "../core/modelClient.js";
import { ConfigManager } from "../core/configManager.js";
import { runReviewEngine } from "../core/reviewEngine.js";
import { detectGitRoot } from "../utils/gitRoot.js";
import { layout } from "../utils/paths.js";
import type { AppConfig } from "../types/config.js";
import type { ModelClient } from "../types/model.js";
import type { ReviewReport } from "../types/review.js";

export interface ReviewOptions {
  cwd: string;
  json?: boolean;
  /** Injectable for tests; defaults to the real LM Studio client. */
  clientFactory?: (config: AppConfig) => ModelClient;
}

export interface ReviewResult {
  hadChanges: boolean;
  report?: ReviewReport;
  raw?: string;
  json: boolean;
}

function defaultClientFactory(config: AppConfig): ModelClient {
  return new LmStudioClient({
    baseUrl: config.model.baseUrl,
    model: config.model.model,
    apiKey: config.model.apiKey,
    temperature: config.model.temperature,
    timeoutMs: config.model.timeoutMs,
  });
}

export async function runReview(opts: ReviewOptions): Promise<ReviewResult> {
  const git = await detectGitRoot(opts.cwd);
  const root = git.root ?? opts.cwd;
  const l = layout(root);
  const config = await new ConfigManager(l.configFile).load();
  const client = (opts.clientFactory ?? defaultClientFactory)(config);

  const result = await runReviewEngine({ cwd: opts.cwd, client });
  return {
    hadChanges: result.hadChanges,
    ...(result.report !== undefined ? { report: result.report } : {}),
    ...(result.raw !== undefined ? { raw: result.raw } : {}),
    json: opts.json ?? false,
  };
}

function bulletList(label: string, items: string[]): string {
  if (items.length === 0) return `${label}: (none)`;
  return `${label}:\n${items.map((i) => `  - ${i}`).join("\n")}`;
}

export function formatReviewResult(result: ReviewResult): string {
  if (!result.hadChanges) {
    return "No changes to review.";
  }
  if (result.report) {
    const r = result.report;
    return [
      "=== Review ===",
      `Summary: ${r.summary || "(none)"}`,
      bulletList("Blocking", r.blocking),
      bulletList("Non-blocking", r.nonBlocking),
      bulletList("Missing tests", r.missingTests),
      bulletList("Scope creep", r.scopeCreep),
      `Recommendation: ${r.recommendation || "(none)"}`,
    ].join("\n");
  }
  // Unparseable — print the raw review verbatim (never blocks).
  return ["=== Review (unparsed) ===", result.raw ?? ""].join("\n");
}
