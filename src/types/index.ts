/**
 * Repository index types and schema (HLD-SRD §3.3, §9).
 *
 * RepoFile — per-file metadata entry.
 * RepoIndex — the full index document written to .ai-orchestrator/index.json.
 */
import { z } from "zod";

export interface RepoFile {
  path: string;
  extension: string;
  size: number;
  language: string;
  summary?: string;
  imports: string[];
  exports: string[];
  isTest: boolean;
  isConfig: boolean;
}

export interface RepoIndex {
  generatedAt: string;
  root: string;
  files: RepoFile[];
}

export const repoFileSchema = z.object({
  path: z.string(),
  extension: z.string(),
  size: z.number(),
  language: z.string(),
  summary: z.string().optional(),
  imports: z.array(z.string()).default([]),
  exports: z.array(z.string()).default([]),
  isTest: z.boolean(),
  isConfig: z.boolean(),
});

export const repoIndexSchema = z.object({
  generatedAt: z.string(),
  root: z.string(),
  files: z.array(repoFileSchema),
});
