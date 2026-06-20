/**
 * `localptp config` (HLD-SRD §3.2).
 *
 * - `config`            → show the full merged config (api_key redacted).
 * - `config <subtree>`  → show that sub-tree (e.g. `config model`).
 * - `config <key> <value>` → coerce, set the dotted path, re-validate, write.
 *
 * The redaction keeps the api_key off stdout/JSON (no-secret display control).
 */
import { layout } from "../utils/paths.js";
import { detectGitRoot } from "../utils/gitRoot.js";
import { ConfigManager } from "../core/configManager.js";
import type { AppConfig } from "../types/config.js";

export interface ConfigOptions {
  cwd: string;
  key?: string;
  value?: string;
  json?: boolean;
}

export interface ConfigResult {
  mode: "show" | "set";
  /** For show: the (redacted) config object or sub-tree. For set: the redacted full config. */
  value: unknown;
  key?: string;
}

const REDACTED = "[REDACTED]";

/** Deep-clone the config and redact the api_key for display. */
function redactConfig(config: AppConfig): AppConfig {
  const clone = structuredClone(config);
  clone.model.apiKey = REDACTED;
  return clone;
}

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function getSubtree(obj: unknown, dotted: string): unknown {
  let cursor: unknown = obj;
  for (const part of dotted.split(".")) {
    if (
      part.length === 0 ||
      FORBIDDEN_KEYS.has(part) ||
      typeof cursor !== "object" ||
      cursor === null ||
      !Object.prototype.hasOwnProperty.call(cursor, part)
    ) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

export async function runConfig(opts: ConfigOptions): Promise<ConfigResult> {
  // Resolve the repo root (like `init`) so config is read/written at the repo
  // root regardless of the subdirectory the command is run from; fall back to
  // cwd outside a Git repo.
  const git = await detectGitRoot(opts.cwd);
  const l = layout(git.root ?? opts.cwd);
  const cm = new ConfigManager(l.configFile);

  // Set mode: a key AND a value were given.
  if (opts.key !== undefined && opts.value !== undefined) {
    const updated = await cm.set(opts.key, opts.value);
    return { mode: "set", key: opts.key, value: redactConfig(updated) };
  }

  // Show mode: full config or a sub-tree.
  const config = await cm.load();
  const redacted = redactConfig(config);
  if (opts.key !== undefined) {
    const subtree = getSubtree(redacted, opts.key);
    if (subtree === undefined) {
      throw new Error(`Unknown config key: ${opts.key}`);
    }
    return { mode: "show", key: opts.key, value: subtree };
  }
  return { mode: "show", value: redacted };
}

export function formatConfigResult(result: ConfigResult): string {
  if (result.mode === "set") {
    return `Set ${result.key}`;
  }
  return JSON.stringify(result.value, null, 2);
}
