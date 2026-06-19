/**
 * `localcoder doctor` (HLD-SRD §3.8, §12, §15 Test 3).
 *
 * Load+validate config → `health()` (GET /models) → `complete()` with a tiny
 * prompt → assert non-empty → return reachable + latency. Transport/protocol
 * failures surface as the typed `ModelClientError` so the caller can print the
 * matching §12 message and exit non-zero.
 */
import { layout } from "../utils/paths.js";
import { detectGitRoot } from "../utils/gitRoot.js";
import { ConfigManager } from "../core/configManager.js";
import { LmStudioClient } from "../core/modelClient.js";
import type { ModelClient } from "../types/model.js";
import type { AppConfig } from "../types/config.js";

export interface DoctorOptions {
  cwd: string;
  json?: boolean;
  /** Injectable for tests; defaults to the real LM Studio client. */
  clientFactory?: (config: AppConfig) => ModelClient;
}

export interface DoctorResult {
  reachable: boolean;
  model?: string;
  latencyMs: number;
  models: string[];
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

export async function runDoctor(opts: DoctorOptions): Promise<DoctorResult> {
  // Resolve the repo root (like `init`) so doctor reads the repo-root config
  // regardless of the subdirectory it runs from; fall back to cwd outside Git.
  const git = await detectGitRoot(opts.cwd);
  const l = layout(git.root ?? opts.cwd);
  const config = await new ConfigManager(l.configFile).load();
  const client = (opts.clientFactory ?? defaultClientFactory)(config);

  const health = await client.health();
  const models = health.models ?? [];

  const start = Date.now();
  const response = await client.complete({
    role: "summarizer",
    systemPrompt: "You are a health check. Reply with a single short word.",
    userPrompt: "ping",
  });
  const latencyMs = Date.now() - start;

  // complete() already throws on empty/malformed; assert defensively.
  if (response.content.length === 0) {
    throw new Error("Model returned an empty/invalid response.");
  }

  return {
    reachable: true,
    model: models[0] ?? config.model.model,
    latencyMs,
    models,
  };
}

export function formatDoctorResult(result: DoctorResult): string {
  return (
    `✓ reachable\n` +
    `model: ${result.model ?? "(unknown)"}\n` +
    `model responded (${result.latencyMs}ms)`
  );
}
