/**
 * The 14 `/ai/*` starter memory templates (HLD-SRD §3.4).
 *
 * Each carries a human-visible, Git-diffable `Last updated:` marker header
 * instead of a sidecar manifest. `{{date}}` is filled at scaffold time.
 */

export interface MemoryTemplate {
  name: string;
  /** Returns the file body for a given ISO date stamp. */
  render(dateStamp: string): string;
}

function tpl(name: string, title: string, body: string): MemoryTemplate {
  return {
    name,
    render(dateStamp: string): string {
      return `# ${title}\n\nLast updated: ${dateStamp}\n\n${body}\n`;
    },
  };
}

export const MEMORY_TEMPLATES: MemoryTemplate[] = [
  tpl(
    "project-brief.md",
    "Project Brief",
    "One-paragraph description of what this project does and who it is for.\n\n## Goals\n\n- \n\n## Non-goals\n\n- ",
  ),
  tpl(
    "repo-map.md",
    "Repo Map",
    "High-level map of the repository's top-level directories and their responsibilities.\n\n_(Generated/updated by `localptp index`.)_",
  ),
  tpl(
    "architecture.md",
    "Architecture",
    "The system's main components and how they fit together.",
  ),
  tpl(
    "file-index.md",
    "File Index",
    "Per-file responsibilities for the important source files.\n\n| File | Responsibility |\n|---|---|",
  ),
  tpl(
    "data-model.md",
    "Data Model",
    "Core entities, their fields, and relationships.",
  ),
  tpl(
    "api-map.md",
    "API Map",
    "Public/internal API surface: endpoints, commands, or exported functions.",
  ),
  tpl(
    "external-integrations.md",
    "External Integrations",
    "Third-party services, APIs, and infrastructure this project depends on.",
  ),
  tpl(
    "coding-rules.md",
    "Coding Rules",
    "Project conventions the model must follow.\n\n- Work in small, safe patches.\n- Prefer existing project patterns.\n- Do not rewrite unrelated code.",
  ),
  tpl(
    "decisions.md",
    "Decisions",
    "Durable architectural and product decisions, newest first.\n\n## Log\n\n- ",
  ),
  tpl(
    "known-issues.md",
    "Known Issues",
    "Known bugs, risks, and technical debt.\n\n- ",
  ),
  tpl(
    "test-plan.md",
    "Test Plan",
    "How this project is tested and which commands to run.\n\n- typecheck\n- lint\n- test\n- build",
  ),
  tpl(
    "local-model-workflow.md",
    "Local Model Workflow",
    "How to drive the local coding model over this repo with `localptp` (init → index → task → plan → step → review → summarize).",
  ),
  tpl(
    "task-template.md",
    "Task Template",
    "Template for `/ai/tasks/*` files.\n\n## Goal\n\n## Background\n\n## Requirements\n\n## Non-goals\n\n## Acceptance Criteria\n\n## Subtasks\n\n- [ ] \n\n## Tests",
  ),
  tpl(
    "session-start.md",
    "Session Start",
    "Read this at the start of every working session before touching code: load the active task and session, review coding rules, and confirm the next step.",
  ),
];

export const MEMORY_FILE_NAMES: string[] = MEMORY_TEMPLATES.map((t) => t.name);
