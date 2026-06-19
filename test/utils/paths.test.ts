import { describe, it, expect } from "vitest";
import path from "node:path";
import { layout } from "../../src/utils/paths.js";

describe("paths.layout", () => {
  const root = path.resolve("/tmp/some-repo");
  const l = layout(root);

  it("computes the .ai-orchestrator layout", () => {
    expect(l.orchestratorDir).toBe(path.join(root, ".ai-orchestrator"));
    expect(l.configFile).toBe(path.join(root, ".ai-orchestrator", "config.yml"));
    expect(l.logsDir).toBe(path.join(root, ".ai-orchestrator", "logs"));
    expect(l.contextPackagesDir).toBe(
      path.join(root, ".ai-orchestrator", "context-packages"),
    );
  });

  it("computes the /ai memory layout including tasks and sessions", () => {
    expect(l.aiDir).toBe(path.join(root, "ai"));
    expect(l.tasksDir).toBe(path.join(root, "ai", "tasks"));
    expect(l.sessionsDir).toBe(path.join(root, "ai", "sessions"));
  });

  it("computes the .gitignore path", () => {
    expect(l.gitignoreFile).toBe(path.join(root, ".gitignore"));
  });

  it("resolves a memory file path by name", () => {
    expect(l.memoryFile("decisions.md")).toBe(
      path.join(root, "ai", "decisions.md"),
    );
  });
});
