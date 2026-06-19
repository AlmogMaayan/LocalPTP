# LocalPTP — LocalCode Orchestrator

A command-line orchestrator that drives a **local** coding model (served by [LM Studio](https://lmstudio.ai/)) over a large codebase. It indexes your repo, builds focused context packages, decomposes a task into ordered subtasks, and applies model-generated diffs through safety gates with approval checkpoints — then reviews and summarizes the work.

Everything runs against a model on your own machine. No code leaves your computer.

## Features

- **Repo indexing** — scans the codebase into `.ai-orchestrator/index.json` and a `/ai` memory map.
- **Context builder** — assembles role-scoped, token-budgeted context for the model.
- **Task planning** — decomposes a task into ordered subtasks via the model.
- **Step/run loop** — model → diff → safety gates → approval → apply → tests, one subtask at a time or looped.
- **Safety gates** — approval prompts, risky-path confirmation, changed-file limits, binary/path-traversal refusals.
- **Review** — advisory review of the current Git diff (modifies nothing).
- **Summarize** — closes the loop by updating `/ai` memory from the session.

## Requirements

- **Node.js ≥ 20**
- **[LM Studio](https://lmstudio.ai/)** running locally with a model loaded and its OpenAI-compatible server started (default `http://localhost:1234/v1`).
  - Default model: **`qwen/qwen3.6-27b`** (configurable — see [Configuration](#configuration)).
- **Git** (the orchestrator operates on a Git working tree).

## Installation

```bash
# 1. Clone
git clone https://github.com/AlmogMaayan/LocalPTP.git
cd LocalPTP

# 2. Install dependencies
npm install

# 3. Build
npm run build
```

### Run it

During development (no build step, runs the TypeScript directly):

```bash
npm run localcoder -- <command>
```

After building, run the compiled CLI:

```bash
node dist/cli.js <command>
```

Or install it globally so `localcoder` is on your `PATH`:

```bash
npm install -g .
localcoder <command>
```

## Quick start

```bash
# 0. Start LM Studio, load qwen/qwen3.6-27b, and start its local server.

# 1. Scaffold /ai memory + .ai-orchestrator/config.yml (idempotent)
localcoder init

# 2. Verify LM Studio is reachable and the model responds
localcoder doctor

# 3. Index the repo
localcoder index

# 4. Create a task
localcoder task "add input validation to the signup form"

# 5. Plan it into subtasks (calls the model)
localcoder plan

# 6. Execute — one subtask, or loop until a stop condition
localcoder step
localcoder run

# 7. Review the diff and summarize the session
localcoder review
localcoder summarize
```

## Commands

| Command | Description |
|---------|-------------|
| `init` | Scaffold `/ai` memory + `.ai-orchestrator/config.yml` (idempotent; no source edits). |
| `config [key] [value]` | Show the merged config, a sub-tree, or set a dotted key (e.g. `config model.model`). |
| `doctor` | Verify LM Studio is reachable and the model responds. |
| `index` | Scan the repo and write `.ai-orchestrator/index.json` + update `/ai` memory map files. |
| `context [--role <role>]` | Preview the context package for a role (read-only; no model call). |
| `task <text>` | Create a scoped task + session and mark them active. |
| `plan` | Decompose the active task into ordered subtasks (calls the model). |
| `resume [index]` | List past sessions and continue from a selected one. |
| `step` | Run the next pending subtask: model → diff → safety gates → approval → apply → tests. |
| `run` | Loop the step cycle over pending subtasks with approval checkpoints until a stop condition. |
| `review` | Review the current Git diff with the model (advisory; modifies nothing). |
| `summarize` | Summarize the session and update `/ai` memory files. |

**Global flags:** `--json` (structured output) · `--debug` (verbose logging).

## Configuration

`localcoder init` writes `.ai-orchestrator/config.yml`. Sensible defaults apply when a field is absent. Key model settings:

```yaml
model:
  provider: lmstudio
  base_url: http://localhost:1234/v1
  model: qwen/qwen3.6-27b
  api_key: lm-studio
  temperature: 0.2
  max_context_tokens: 32768
  timeout_ms: 60000
```

Read or change values from the CLI:

```bash
localcoder config model.model              # show current model
localcoder config model.model qwen/qwen3.6-27b   # set the model
localcoder config model.baseUrl            # show the LM Studio endpoint
```

Safety, context, and command settings (typecheck/lint/test/build) are also configurable — run `localcoder config` to see the full merged tree.

## Development

```bash
npm run build       # compile TypeScript to dist/
npm run typecheck   # type-check without emitting
npm test            # run the vitest suite
```

## License

[MIT](./LICENSE) © 2026 Maayan Almog
</content>
