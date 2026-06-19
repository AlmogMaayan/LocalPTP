/**
 * Config schema — single source of truth for shape AND defaults (HLD-SRD §3.2, §9).
 *
 * Every field carries a `.default(...)` so an absent/empty config still parses
 * to the full HLD-SRD §3.2 object. `AppConfig` is inferred from the schema.
 */
import { z } from "zod";

export const modelConfigSchema = z.object({
  provider: z.literal("lmstudio").default("lmstudio"),
  baseUrl: z.string().default("http://localhost:1234/v1"),
  model: z.string().default("qwen/qwen3.6-27b"),
  apiKey: z.string().default("lm-studio"),
  temperature: z.number().default(0.2),
  maxContextTokens: z.number().int().default(32768),
  // Request timeout (ms) used by the ModelClient. Not in §3.2 but needed by the
  // client/doctor; defaults conservatively.
  timeoutMs: z.number().int().default(60000),
});

export const contextConfigSchema = z.object({
  maxContextChars: z.number().int().default(120000),
  maxFilesPerStep: z.number().int().default(12),
  maxEditFilesPerStep: z.number().int().default(5),
  maxFileChars: z.number().int().default(50000),
  includeTests: z.boolean().default(true),
  includeImportNeighbors: z.boolean().default(true),
});

export const safetyConfigSchema = z.object({
  requireApproval: z.boolean().default(true),
  maxFailedFixAttempts: z.number().int().default(2),
  maxChangedFilesPerStep: z.number().int().default(5),
  riskyPaths: z
    .array(z.string())
    .default([
      "**/auth/**",
      "**/billing/**",
      "**/payments/**",
      "**/migrations/**",
      ".env*",
    ]),
});

export const commandConfigSchema = z.object({
  typecheck: z.string().default("npm run typecheck"),
  lint: z.string().default("npm run lint"),
  test: z.string().default("npm test"),
  build: z.string().default("npm run build"),
});

export const appConfigSchema = z.object({
  model: modelConfigSchema.default({}),
  context: contextConfigSchema.default({}),
  safety: safetyConfigSchema.default({}),
  commands: commandConfigSchema.default({}),
  ignore: z
    .array(z.string())
    .default([
      "node_modules",
      ".git",
      ".next",
      "dist",
      "build",
      "coverage",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
    ]),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type ContextConfig = z.infer<typeof contextConfigSchema>;
export type SafetyConfig = z.infer<typeof safetyConfigSchema>;
export type CommandConfig = z.infer<typeof commandConfigSchema>;
