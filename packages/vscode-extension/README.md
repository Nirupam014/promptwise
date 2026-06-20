# PromptWise — VS Code Extension

Rewrite a prompt right inside your editor before you paste it into an AI
assistant. Works as a model for any JetBrains-style IDE adapter too.

## Run it (development host)

1. Open this `vscode-extension` folder in VS Code.
2. Press **F5** to launch an Extension Development Host.
3. In the new window, select some prompt text, then run **PromptWise: Optimize
   Selected Prompt** (⌘⌥P / Ctrl+Alt+P) — or right-click the selection.

## Commands

| Command | What it does |
|---------|--------------|
| `PromptWise: Optimize Selected Prompt` | Rewrites the selection; **Apply** replaces it, **Copy** copies the result. |
| `PromptWise: Optimize a Prompt (input box)` | Paste a prompt into an input box and get a tightened version. |
| `PromptWise: Add Fact to Global Memory` | Store a durable fact the engine dedupes future prompts against. |

The result dialog shows the token saving, the detected persona (developer when
you're in code), and a preview before you apply.

## In Copilot Chat (`@promptwise`)

If you use GitHub Copilot Chat (VS Code 1.95+), PromptWise registers a chat
participant and agent tools — so it lives one keystroke away inside the chat:

- **`@promptwise <prompt>`** — optimize a prompt (or `/optimize`, `/summarize`,
  `/remember <fact>`, `/recall`).
- **Agent tools** — in Copilot's **agent mode**, the model can call
  `promptwise_optimize`, `promptwise_summarize`, and `promptwise_recall`
  itself, or you can reference them with `#promptwiseOptimize` etc.

> Important: this makes PromptWise **invocable** inside Copilot Chat — it does
> **not** silently rewrite Copilot's own prompts. No VS Code API lets one
> extension intercept another's model calls, so transparent pre-send compression
> for Copilot/Augment/Cursor isn't possible; `@promptwise` and the tools are the
> closest integration (user- or agent-invoked).

## Settings

- `promptwise.minSaving` (default `3`) — minimum token saving before a rewrite is
  offered.

## How it's wired

The shared engine is vendored under `vendor/core` (a copy of
`packages/core/src`) and required by `extension.js`, so the extension is
self-contained. Memory and stats persist in the extension's `globalState`.

Refresh the vendored engine after changing core:

```bash
cp ../core/src/{tokens,text,protect,memory,persona,rewrite,flood,engine,index}.js vendor/core/
```
