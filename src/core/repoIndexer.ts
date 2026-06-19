/**
 * Repo Indexer (HLD-SRD §3.3, §16.2).
 *
 * buildIndex — directory walk with layered ignore, per-file metadata, import/export extraction.
 * Heuristics only (no model call, no AST).
 */
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import type { AppConfig } from "../types/config.js";
import { repoIndexSchema, type RepoFile, type RepoIndex } from "../types/index.js";

// ---------------------------------------------------------------------------
// Extension → language map
// ---------------------------------------------------------------------------

const EXT_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".md": "markdown",
  ".json": "json",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".fish": "shell",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".c": "c",
  ".h": "c",
  ".hpp": "cpp",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".sql": "sql",
  ".r": "r",
  ".swift": "swift",
  ".dart": "dart",
  ".lua": "lua",
  ".pl": "perl",
  ".pm": "perl",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hrl": "erlang",
  ".hs": "haskell",
  ".lhs": "haskell",
  ".scala": "scala",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".tf": "terraform",
  ".tfvars": "terraform",
  ".proto": "protobuf",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".xml": "xml",
  ".svg": "xml",
  ".txt": "text",
  ".csv": "csv",
  ".env": "dotenv",
};

export const KNOWN_BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".tiff", ".tif",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods",
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar", ".tgz",
  ".mp3", ".mp4", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".m4v",
  ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm",
  ".exe", ".dll", ".so", ".dylib", ".lib", ".a", ".o", ".wasm",
  ".bin", ".dat", ".db", ".sqlite", ".sqlite3",
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
  ".class", ".jar", ".pyc", ".pyo",
]);

export function detectLanguage(ext: string): string {
  if (!ext) return "unknown";
  return EXT_LANGUAGE_MAP[ext.toLowerCase()] ?? "unknown";
}

// ---------------------------------------------------------------------------
// Path heuristics
// ---------------------------------------------------------------------------

export function isTestPath(rel: string): boolean {
  const posix = rel.replace(/\\/g, "/");
  // *.test.* or *.spec.*
  if (/\.(test|spec)\.[^/]+$/.test(posix)) return true;
  // __tests__/ anywhere in path
  if (/(^|\/)__tests__\//.test(posix)) return true;
  // /tests/ as a directory segment (not just "tests" as suffix of another word)
  if (/(^|\/)tests\//.test(posix)) return true;
  return false;
}

const CONFIG_NAMES = new Set([
  "tsconfig.json", "tsconfig.base.json", "tsconfig.build.json",
  "jsconfig.json",
  ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.yaml", ".eslintrc.yml", ".eslintrc.json",
  ".prettierrc", ".prettierrc.js", ".prettierrc.cjs", ".prettierrc.yaml", ".prettierrc.yml", ".prettierrc.json",
  ".babelrc", ".babelrc.js", ".babelrc.cjs",
  ".stylelintrc",
  ".editorconfig", ".gitignore", ".gitattributes", ".npmignore", ".npmrc", ".nvmrc",
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
  "Makefile", "Dockerfile", ".dockerignore",
  "jest.config.js", "jest.config.ts", "jest.config.cjs", "jest.config.mjs",
  "vitest.config.ts", "vitest.config.js", "vitest.config.mts",
  "webpack.config.js", "webpack.config.ts",
  "rollup.config.js", "rollup.config.ts", "rollup.config.mjs",
  "babel.config.js", "babel.config.cjs", "babel.config.mjs",
  "postcss.config.js", "postcss.config.cjs",
  "tailwind.config.js", "tailwind.config.ts",
  "next.config.js", "next.config.ts", "next.config.mjs",
  "vite.config.js", "vite.config.ts", "vite.config.mts",
  "svelte.config.js",
  "astro.config.mjs",
  "nuxt.config.ts", "nuxt.config.js",
  "remix.config.js",
  "vercel.json", "netlify.toml", "fly.toml",
  ".travis.yml", ".circleci",
  "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt",
  "Cargo.toml", "Cargo.lock",
  "go.mod", "go.sum",
  "Gemfile", "Gemfile.lock",
]);

const CONFIG_FILENAME_PATTERNS = [
  /^\..*rc$/,           // .eslintrc, .prettierrc, .babelrc, etc.
  /\.config\.[^/]+$/,   // *.config.ts, *.config.js, etc.
];

const ROOT_ONLY_EXTENSIONS = new Set([".yml", ".yaml"]);

export function isConfigPath(rel: string): boolean {
  const posix = rel.replace(/\\/g, "/");
  const basename = posix.split("/").pop() ?? posix;
  const isRoot = !posix.includes("/");

  // Named config files — always config regardless of depth
  if (CONFIG_NAMES.has(basename)) return true;

  // Pattern-based: *.config.* or .XXXrc
  for (const pattern of CONFIG_FILENAME_PATTERNS) {
    if (pattern.test(basename)) return true;
  }

  // Root-only extensions: .yml/.yaml at repo root only
  const ext = path.extname(basename).toLowerCase();
  if (ROOT_ONLY_EXTENSIONS.has(ext) && isRoot) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

const MAX_SNIFF_BYTES = 8192;

export function isBinary(ext: string, head: Buffer): boolean {
  if (ext && KNOWN_BINARY_EXT.has(ext.toLowerCase())) return true;
  // NUL byte sniff
  for (let i = 0; i < Math.min(head.length, MAX_SNIFF_BYTES); i++) {
    if (head[i] === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Import / export extraction
// ---------------------------------------------------------------------------

const MAX_PARSE_SIZE = 1024 * 1024; // 1 MB

function dedup(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

const TS_IMPORT_REGEXES: RegExp[] = [
  /^\s*import\s+.*?from\s+['"]([^'"]+)['"]/,   // import x from '...'
  /^\s*import\s+['"]([^'"]+)['"]/,              // import '...'  (side-effect)
];
const REQUIRE_REGEX = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_REGEX = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

const TS_EXPORT_DECLARED_REGEX =
  /^\s*export\s+(?:default\s+)?(?:abstract\s+)?(?:const|function|class|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)/;
// Named export list WITHOUT a `from` clause: export { A, B };
// Allows an optional `type` modifier on the whole list (`export type { A }`),
// which is stripped so the captured names are clean symbol names.
const TS_EXPORT_LIST_REGEX = /^\s*export\s+(?:type\s+)?\{([^}]+)\}\s*;?\s*$/;

export function extractImports(text: string, lang: string): string[] {
  if (lang !== "typescript" && lang !== "javascript" && lang !== "python") return [];
  if (text.length > MAX_PARSE_SIZE) return [];

  const specifiers: string[] = [];

  if (lang === "typescript" || lang === "javascript") {
    for (const line of text.split("\n")) {
      for (const re of TS_IMPORT_REGEXES) {
        const m = re.exec(line);
        if (m) {
          specifiers.push(m[1]);
          break;
        }
      }
    }
    // require() and dynamic import() — multi-match per line
    let m: RegExpExecArray | null;
    const reqRe = new RegExp(REQUIRE_REGEX.source, "g");
    while ((m = reqRe.exec(text)) !== null) {
      specifiers.push(m[1]);
    }
    const dynRe = new RegExp(DYNAMIC_IMPORT_REGEX.source, "g");
    while ((m = dynRe.exec(text)) !== null) {
      specifiers.push(m[1]);
    }
  } else if (lang === "python") {
    for (const line of text.split("\n")) {
      {
        const m = /^\s*import\s+([\w.]+)/.exec(line);
        if (m) { specifiers.push(m[1]); continue; }
      }
      {
        const m = /^\s*from\s+([\w.]+)\s+import\s+/.exec(line);
        if (m) { specifiers.push(m[1]); }
      }
    }
  }

  return dedup(specifiers);
}

export function extractExports(text: string, lang: string): string[] {
  if (lang !== "typescript" && lang !== "javascript") return [];
  if (text.length > MAX_PARSE_SIZE) return [];

  const names: string[] = [];

  for (const line of text.split("\n")) {
    // Skip re-exports: export { ... } from '...' or export * from '...'
    if (/^\s*export\s+.*\bfrom\s+['"]/.test(line)) continue;

    // export const/function/class/let/var FOO  or  export default function fn
    const declared = TS_EXPORT_DECLARED_REGEX.exec(line);
    if (declared) {
      names.push(declared[1]);
      continue;
    }

    // export { A, B, C };  (no `from` clause — already excluded above)
    const list = TS_EXPORT_LIST_REGEX.exec(line);
    if (list) {
      for (const part of list[1].split(",")) {
        // Strip an inline `type` modifier (`export { type Foo }`) before taking
        // the local name (the part before any `as` alias).
        const cleaned = part.trim().replace(/^type\s+/, "");
        const name = cleaned.split(/\s+as\s+/)[0].trim();
        if (name) names.push(name);
      }
    }
  }

  return dedup(names);
}

// ---------------------------------------------------------------------------
// Ignore resolution
// ---------------------------------------------------------------------------

/**
 * Baseline paths always excluded (relative POSIX globs / names).
 * Excludes the tool's own generated artifacts so re-runs stay idempotent.
 */
export const BASELINE_IGNORE = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".ai-orchestrator",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

// The two tool-rewritten memory files (POSIX relative)
const TOOL_REWRITTEN_FILES = new Set([
  "ai/repo-map.md",
  "ai/file-index.md",
]);

function matchesBaseline(rel: string, isDir: boolean, configIgnore: string[]): boolean {
  const parts = rel.split("/");

  // Baseline names match at ANY path depth, not just the repo root, so a
  // forgotten nested `packages/app/node_modules` (or `.git`, `dist`, etc.) is
  // still pruned — the baseline is defined to always prune well-known
  // generated/dependency trees regardless of nesting.
  for (const seg of parts) {
    if (BASELINE_IGNORE.has(seg)) return true;
  }

  // Tool-rewritten files
  if (TOOL_REWRITTEN_FILES.has(rel)) return true;

  // Lock file names at any depth
  const basename = parts[parts.length - 1];
  if (basename === "package-lock.json" || basename === "pnpm-lock.yaml" || basename === "yarn.lock") return true;

  // Config ignore entries: treated as glob-like prefix match or exact basename
  for (const pat of configIgnore) {
    if (rel === pat) return true;
    if (rel.startsWith(pat + "/")) return true;
    if (basename === pat) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Walk + buildIndex
// ---------------------------------------------------------------------------

export interface BuildIndexOptions {
  root: string;
  config: AppConfig;
}

export async function buildIndex(root: string, config: AppConfig): Promise<RepoIndex> {
  const normRoot = root.replace(/\\/g, "/");

  // Detect git
  const git = simpleGit(root);
  let isGit = false;
  try {
    isGit = await git.checkIsRepo();
  } catch {
    isGit = false;
  }

  const files: RepoFile[] = [];
  let ignoredCount = 0;

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: "utf8" }) as Dirent[];
    } catch {
      return; // Directory removed mid-walk — skip
    }

    // Collect candidate paths for batched git check-ignore
    const candidates: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      candidates.push(rel);
    }

    // Batch check-ignore for git repos
    let gitIgnored = new Set<string>();
    if (isGit && candidates.length > 0) {
      try {
        const result = await git.checkIgnore(candidates);
        // normalize results to POSIX relative
        for (const r of result) {
          gitIgnored.add(r.replace(/\\/g, "/"));
        }
      } catch {
        // checkIgnore fails gracefully
      }
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");

      // Apply ignore: baseline + config always; git additionally
      if (matchesBaseline(rel, entry.isDirectory(), config.ignore)) {
        ignoredCount++;
        continue;
      }
      if (isGit && gitIgnored.has(rel)) {
        ignoredCount++;
        continue;
      }

      if (entry.isSymbolicLink()) {
        // Record symlink via lstat, do not follow. If the link vanished
        // mid-walk, skip it rather than emitting a fabricated size.
        let size: number;
        try {
          const stat = await fs.lstat(full);
          size = stat.size;
        } catch {
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        files.push({
          path: rel,
          extension: ext,
          size,
          language: detectLanguage(ext),
          isTest: isTestPath(rel),
          isConfig: isConfigPath(rel),
          imports: [],
          exports: [],
        });
        continue;
      }

      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const meta = await buildFileMeta(full, rel);
        if (meta) files.push(meta);
      }
    }
  }

  await walk(root);

  // Sort by path
  files.sort((a, b) => a.path.localeCompare(b.path));

  const index: RepoIndex = {
    generatedAt: new Date().toISOString(),
    root: normRoot,
    files,
  };

  // Validate
  repoIndexSchema.parse(index);

  // Attach ignoredCount as a side channel (not in schema) — stored in a module-level variable
  // We store it in the closure via the walk; return it separately.
  (index as RepoIndex & { _ignoredCount?: number })._ignoredCount = ignoredCount;

  return index;
}

async function buildFileMeta(full: string, rel: string): Promise<RepoFile | null> {
  let size: number;
  try {
    const stat = await fs.lstat(full);
    size = stat.size;
  } catch {
    // File removed mid-walk — skip it rather than emitting an entry with a
    // fabricated size (documented edge case: a file removed during the scan is
    // skipped, not fatal).
    return null;
  }

  const ext = path.extname(path.basename(rel)).toLowerCase();
  const lang = detectLanguage(ext);
  const large = size > MAX_PARSE_SIZE;

  let imports: string[] = [];
  let exports: string[] = [];

  if (!large) {
    let headBuf: Buffer;
    try {
      const fd = await fs.open(full, "r");
      try {
        const buf = Buffer.alloc(Math.min(MAX_SNIFF_BYTES, size || MAX_SNIFF_BYTES));
        const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
        headBuf = buf.subarray(0, bytesRead);
      } finally {
        // Always release the descriptor, even if read() throws — otherwise a
        // run over many unreadable files could exhaust file descriptors.
        await fd.close();
      }
    } catch {
      headBuf = Buffer.alloc(0);
    }

    if (!isBinary(ext, headBuf)) {
      // Try to read as UTF-8
      let text: string | null = null;
      try {
        text = await fs.readFile(full, "utf8");
      } catch {
        // Non-UTF8 or unreadable — treat as binary
        text = null;
      }
      if (text !== null) {
        imports = extractImports(text, lang);
        exports = extractExports(text, lang);
      }
    }
  }

  return {
    path: rel,
    extension: ext,
    size,
    language: lang,
    isTest: isTestPath(rel),
    isConfig: isConfigPath(rel),
    imports,
    exports,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const FILE_INDEX_CAP = 500;

export function renderRepoMap(index: RepoIndex): string {
  if (index.files.length === 0) {
    return "_0 files indexed._\n";
  }

  // Language counts
  const langCounts = new Map<string, number>();
  for (const f of index.files) {
    langCounts.set(f.language, (langCounts.get(f.language) ?? 0) + 1);
  }
  const langLines = [...langCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lang, count]) => `- ${lang}: ${count}`)
    .join("\n");

  // Directory breakdown (top-level)
  const dirCounts = new Map<string, number>();
  for (const f of index.files) {
    const top = f.path.includes("/") ? f.path.split("/")[0] : "(root)";
    dirCounts.set(top, (dirCounts.get(top) ?? 0) + 1);
  }
  const dirLines = [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([dir, count]) => `- ${dir}: ${count}`)
    .join("\n");

  const testCount = index.files.filter((f) => f.isTest).length;
  const configCount = index.files.filter((f) => f.isConfig).length;
  const totalSize = index.files.reduce((s, f) => s + f.size, 0);
  const sizeKb = (totalSize / 1024).toFixed(1);

  return [
    `**Total:** ${index.files.length} files · ${sizeKb} KB`,
    "",
    "**Languages:**",
    langLines,
    "",
    "**Top-level directories:**",
    dirLines,
    "",
    `**Test files:** ${testCount} · **Config files:** ${configCount}`,
    "",
    `_Generated at ${index.generatedAt}_`,
  ].join("\n");
}

export function renderFileIndex(index: RepoIndex): string {
  if (index.files.length === 0) {
    return "_No files indexed._\n";
  }

  const header = "| path | language | size | isTest | isConfig |";
  const sep    = "|------|----------|------|--------|----------|";
  const rows = index.files.slice(0, FILE_INDEX_CAP).map(
    (f) => `| ${f.path} | ${f.language} | ${f.size} | ${f.isTest} | ${f.isConfig} |`,
  );

  const extra = index.files.length - FILE_INDEX_CAP;
  const footer =
    extra > 0
      ? `\n_+${extra} more (see index.json)_`
      : "";

  return [header, sep, ...rows].join("\n") + footer;
}
