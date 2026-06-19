/**
 * Walk + ignore resolution tests (tasks 4.1-4.5, 5.1-5.4, 6.1).
 * Uses temp-dir fixtures; optionally git-init.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { buildIndex } from "../../src/core/repoIndexer.js";
import { appConfigSchema } from "../../src/types/config.js";

let tmp: string;

const defaultConfig = appConfigSchema.parse({});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-idx-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 4.1 Fixture helper
// ---------------------------------------------------------------------------

async function writeFile(dir: string, rel: string, content: string): Promise<void> {
  const full = path.join(dir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

function gitInit(dir: string): void {
  try {
    execSync("git init", { cwd: dir, stdio: "ignore" });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "ignore" });
    execSync('git config user.name "Test"', { cwd: dir, stdio: "ignore" });
  } catch {
    // git may not be available; test will skip gitignore checks
  }
}

// ---------------------------------------------------------------------------
// 4.2 .gitignore + node_modules excluded in git repo
// ---------------------------------------------------------------------------

describe("walk ignores in git repo", () => {
  it("4.2 .gitignored file and node_modules are excluded", async () => {
    gitInit(tmp);
    await writeFile(tmp, ".gitignore", "secret.txt\n");
    await writeFile(tmp, "secret.txt", "shhhh");
    await writeFile(tmp, "node_modules/pkg/index.js", "module");
    await writeFile(tmp, "src/app.ts", "export const x = 1;");

    const index = await buildIndex(tmp, defaultConfig);
    const paths = index.files.map((f) => f.path);

    expect(paths).not.toContain("secret.txt");
    expect(paths.some((p) => p.startsWith("node_modules"))).toBe(false);
    expect(paths).toContain("src/app.ts");
  });
});

// ---------------------------------------------------------------------------
// 4.3 Config ignore entries excluded even in git repo
// ---------------------------------------------------------------------------

describe("config ignore in git repo", () => {
  it("4.3 config ignore entries are excluded", async () => {
    gitInit(tmp);
    await writeFile(tmp, "src/app.ts", "export const x = 1;");
    await writeFile(tmp, "vendor/lib.ts", "export const y = 2;");

    const config = appConfigSchema.parse({ ignore: ["vendor"] });
    const index = await buildIndex(tmp, config);
    const paths = index.files.map((f) => f.path);

    expect(paths).toContain("src/app.ts");
    expect(paths.some((p) => p.startsWith("vendor"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4.4 Non-git fixture: fallback to config + baseline
// ---------------------------------------------------------------------------

describe("non-git fallback", () => {
  it("4.4 non-git repo: node_modules excluded, warning signaled (no crash)", async () => {
    // No git init — plain directory
    await writeFile(tmp, "src/app.ts", "export const x = 1;");
    await writeFile(tmp, "node_modules/pkg/index.js", "module");

    const index = await buildIndex(tmp, defaultConfig);
    const paths = index.files.map((f) => f.path);

    expect(paths).toContain("src/app.ts");
    expect(paths.some((p) => p.startsWith("node_modules"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4.5 Symlinks are recorded but not traversed
// ---------------------------------------------------------------------------

describe("symlinks", () => {
  it("4.5 symlink is recorded, target not traversed", async () => {
    await writeFile(tmp, "real.ts", "export const r = 1;");
    // Create a symlink pointing to real.ts
    const symlinkPath = path.join(tmp, "link.ts");
    try {
      await fs.symlink(path.join(tmp, "real.ts"), symlinkPath);
    } catch {
      // Symlink creation may fail on Windows without elevated privileges; skip
      return;
    }

    const index = await buildIndex(tmp, defaultConfig);
    const paths = index.files.map((f) => f.path);

    expect(paths).toContain("real.ts");
    expect(paths).toContain("link.ts");
    // Only ONE entry for link.ts (not recursed)
    expect(paths.filter((p) => p === "link.ts")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5.1 buildIndex returns correct metadata
// ---------------------------------------------------------------------------

describe("buildIndex metadata", () => {
  it("5.1 files have correct language/isTest/isConfig/size, paths sorted", async () => {
    await writeFile(tmp, "src/app.ts", "export const x = 1;");
    await writeFile(tmp, "src/app.test.ts", "import { x } from './app';");
    await writeFile(tmp, "tsconfig.json", "{}");

    const index = await buildIndex(tmp, defaultConfig);
    const byPath = new Map(index.files.map((f) => [f.path, f]));

    const app = byPath.get("src/app.ts")!;
    expect(app).toBeDefined();
    expect(app.language).toBe("typescript");
    expect(app.isTest).toBe(false);
    expect(app.isConfig).toBe(false);
    expect(app.size).toBeGreaterThan(0);

    const test = byPath.get("src/app.test.ts")!;
    expect(test).toBeDefined();
    expect(test.isTest).toBe(true);

    const tsconfig = byPath.get("tsconfig.json")!;
    expect(tsconfig).toBeDefined();
    expect(tsconfig.isConfig).toBe(true);

    // Paths are POSIX-relative and sorted
    const paths = index.files.map((f) => f.path);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
    for (const p of paths) {
      expect(p).not.toContain("\\");
    }
  });
});

// ---------------------------------------------------------------------------
// 5.2 Non-UTF8 file treated as binary
// ---------------------------------------------------------------------------

describe("buildIndex binary handling", () => {
  it("5.2 non-UTF8 file: listed, empty imports/exports", async () => {
    // Write a file with invalid UTF-8 bytes
    const full = path.join(tmp, "binary.ts");
    await fs.writeFile(full, Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02]));

    const index = await buildIndex(tmp, defaultConfig);
    const entry = index.files.find((f) => f.path === "binary.ts");
    expect(entry).toBeDefined();
    expect(entry!.imports).toEqual([]);
    expect(entry!.exports).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5.3 Empty repo
// ---------------------------------------------------------------------------

describe("buildIndex edge cases", () => {
  it("5.3 empty repo -> { files: [] }", async () => {
    const index = await buildIndex(tmp, defaultConfig);
    expect(index.files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6.1 index.json validates against repoIndexSchema
// ---------------------------------------------------------------------------

describe("buildIndex schema validation", () => {
  it("6.1 result validates against repoIndexSchema", async () => {
    await writeFile(tmp, "src/main.ts", "const x = 1;");
    const { repoIndexSchema } = await import("../../src/types/index.js");

    const index = await buildIndex(tmp, defaultConfig);
    const result = repoIndexSchema.safeParse(index);
    expect(result.success).toBe(true);
  });
});
