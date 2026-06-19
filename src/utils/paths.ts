/**
 * Path layout for the `.ai-orchestrator` internal dir and the `/ai` memory dir
 * (HLD-SRD §4). The `/ai` dir is rooted directly at the repo root.
 */
import path from "node:path";

export interface Layout {
  root: string;
  orchestratorDir: string;
  configFile: string;
  logsDir: string;
  contextPackagesDir: string;
  aiDir: string;
  tasksDir: string;
  sessionsDir: string;
  gitignoreFile: string;
  memoryFile(name: string): string;
}

export function layout(root: string): Layout {
  const orchestratorDir = path.join(root, ".ai-orchestrator");
  const aiDir = path.join(root, "ai");
  return {
    root,
    orchestratorDir,
    configFile: path.join(orchestratorDir, "config.yml"),
    logsDir: path.join(orchestratorDir, "logs"),
    contextPackagesDir: path.join(orchestratorDir, "context-packages"),
    aiDir,
    tasksDir: path.join(aiDir, "tasks"),
    sessionsDir: path.join(aiDir, "sessions"),
    gitignoreFile: path.join(root, ".gitignore"),
    memoryFile(name: string): string {
      return path.join(aiDir, name);
    },
  };
}
