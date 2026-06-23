# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-06-23

### Fixed

- **Summarizer** (`@promptwise-dev/core`): a thread that restated one idea many
  times could fill the summary with that single theme and drop the actual
  conclusion. Sentence selection now adds a U-shaped position prior (favoring
  the opening topic and closing decision), a decision-cue boost, and MMR-based
  redundancy penalty, so repeated themes no longer crowd out distinct points or
  the outcome. Vendored core re-synced into the browser and VS Code extensions.

## [1.0.0] - 2026-06-20

Initial release.

### Core engine (`@promptwise-dev/core`)

- Zero-dependency, runs in Node and the browser.
- **Heuristic rewrite**: filler/hedge removal, verbose-phrase simplification,
  context/memory dedup, **reference replacement** for re-pasted blocks, verbatim
  preservation of code/URLs/numbers, never-longer guarantee, configurable
  similarity thresholds.
- **Context-flood detection** with summarize/reset recommendations.
- **Pure-JS extractive summarizer** (no model needed).
- **Global memory** with dedup and relevance lookup.
- **Persona** inference per surface.
- **Output brevity** directives (`outputBudget`) to cut output tokens.
- **Model-fit check** — flags an expensive model on a cheap task and suggests a
  cheaper one (`assessModel`, `signals.model`).
- **Pluggable LLM layer** with guardrails and heuristic fallback:
  - **Ollama** adapter — complete, streaming, model list, pull, and precise
    connection diagnosis (down / origin-blocked / model-missing).
  - **Chrome built-in AI** adapter (Gemini Nano).
  - **WebLLM** adapter (in-browser WebGPU).
  - Engine methods: `optimizeWithLLM`, `optimizeWithLLMStream`,
    `summarizeThread`, `curateMemory`.

### Surfaces

- **CLI** (`@promptwise-dev/cli`): optimize, flood, summarize, memory (incl.
  LLM curate), stats, and an interactive `session` token/context tracker;
  `--llm` (Ollama, streaming), `--brief`/`--max-words`, `--raw`, `--for-model`.
  **`promptwise init`** detects shell + coding agents (Claude Code, Aider,
  Auggie, Cursor, Goose) + Ollama and writes consented wrappers + a Claude Code
  hook.
- **Browser extension** (Chrome + Firefox, MV3): inline rewrite chip with
  streaming **✦ Deep**, context-flood banner with summarize-and-reset, popup
  with model dropdown / pull / smart Ollama diagnostics, token-saving settings,
  global memory. Backends: Ollama, Chrome built-in AI, WebLLM.
- **VS Code extension**: optimize / deep-optimize (streaming) / summarize /
  curate-memory commands, output-budget setting, status bar, plus an
  `@promptwise` Copilot Chat participant and agent-callable language-model tools.
- **MCP connector**: exposes PromptWise as tools inside Claude desktop
  (optimize / summarize / analyze / remember-recall), sharing memory with the CLI.
- **Desktop companion** (Electron, *experimental*): tray app + global hotkey
  optimizer for the native desktop AI apps. Works but unpolished/unsigned.

### Tooling

- npm workspaces monorepo, MIT licensed, CI (Node 18/20/22) + lint + tag-driven
  release workflow, vendored-core sync check, Firefox build script, ESLint +
  Prettier, 62 unit tests.
