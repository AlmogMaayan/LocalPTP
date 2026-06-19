/**
 * `localcoder index` (HLD-SRD §3.3, §5, §9).
 *
 * Offline filesystem scan: no model call, no stdin. Workflow:
 *   1. Detect repo root (warn when non-git).
 *   2. Load config.
 *   3. buildIndex(root, config) → RepoIndex.
 *   4. Write .ai-orchestrator/index.json (pretty JSON).
 *   5. updateMarkerSection × 2 (ai/repo-map.md, ai/file-index.md).
 *   6. Return structured summary.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { detectGitRoot } from "../utils/gitRoot.js";
import { ensureDir } from "../utils/fs.js";
import { layout } from "../utils/paths.js";
import { ConfigManager } from "../core/configManager.js";
import { buildIndex, renderRepoMap, renderFileIndex } from "../core/repoIndexer.js";
import { updateMarkerSection } from "../core/memoryManager.js";

export interface IndexOptions {
  cwd: string;
  json?: boolean;
  onWarning?: (msg: string) => void;
}

export interface IndexResult {
  indexed: number;
  ignored: number;
  durationMs: number;
  root: string;
}

export async function runIndex(opts: IndexOptions): Promise<IndexResult> {
  const { cwd, onWarning } = opts;
  const warn = (msg: string) => {
    if (onWarning) {
      onWarning(msg);
    } else {
      process.stderr.write(`warning: ${msg}\n`);
    }
  };

  const t0 = Date.now();

  // 1. Detect root
  const git = await detectGitRoot(cwd);
  if (!git.isRepo) {
    warn("This directory is not a Git repository. localcoder index will use config + baseline ignore only.");
  }
  const root = git.root ?? cwd;
  const l = layout(root);

  // 2. Load config
  const config = await new ConfigManager(l.configFile).load();

  // 3. Build index
  const index = await buildIndex(root, config);

  // Extract ignored count (stored as side-channel property)
  const ignored = (index as { _ignoredCount?: number })._ignoredCount ?? 0;

  // 4. Write index.json
  const indexJsonPath = path.join(l.orchestratorDir, "index.json");
  await ensureDir(l.orchestratorDir);

  // Remove the internal _ignoredCount before serializing
  const toWrite = { ...index } as Record<string, unknown>;
  delete toWrite._ignoredCount;
  await fs.writeFile(indexJsonPath, JSON.stringify(toWrite, null, 2) + "\n", "utf8");

  // 5. Update marker sections in memory files
  const repoMapPath = path.join(l.aiDir, "repo-map.md");
  const fileIndexPath = path.join(l.aiDir, "file-index.md");

  const repoMapBody = renderRepoMap(index);
  const fileIndexBody = renderFileIndex(index);

  await updateMarkerSection(repoMapPath, "index", repoMapBody);
  await updateMarkerSection(fileIndexPath, "index", fileIndexBody);

  const durationMs = Date.now() - t0;

  return {
    indexed: index.files.length,
    ignored,
    durationMs,
    root,
  };
}

export function formatIndexResult(result: IndexResult): string {
  const s = (result.durationMs / 1000).toFixed(1);
  return `Indexed ${result.indexed} files (ignored ${result.ignored}) · ${s}s`;
}
