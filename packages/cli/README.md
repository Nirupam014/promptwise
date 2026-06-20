# PromptWise CLI

Optimize prompts, detect context floods, and manage memory from any terminal or
coding agent. Zero dependencies — just Node.

## Install

```bash
# from the repo root
chmod +x packages/cli/promptwise.js
alias promptwise="node $(pwd)/packages/cli/promptwise.js"
```

## One-command onboarding

```bash
promptwise init
```

`init` detects your shell, your installed coding agents (Claude Code, Aider,
Auggie, Cursor, Goose), and whether Ollama is running, asks a couple of
questions, then writes the right config so PromptWise is seamless:

- a managed block in your shell rc with **`pwo`** (prints the optimized prompt
  for any agent) and per-agent one-shot wrappers like **`ccp`** for Claude Code
  (`claude -p` with the prompt pre-optimized);
- optionally, a **Claude Code `UserPromptSubmit` hook** so interactive sessions
  auto-inject your saved memory + a context-flood nudge.

Then `source ~/.zshrc` (or open a new terminal) and:

```bash
ccp "could you please help me refactor this in order to clean it up"   # Claude Code, auto-optimized
pwo "summarize the diff please"                                        # optimized text for any agent
```

### Consent — nothing is written without it

`init` never modifies a file silently:

- It **lists every file it will change** first, then asks **"Apply the changes
  above?"** before writing anything.
- Each surface is **individually opt-in**: shell wrappers, the Claude Code hook,
  and the **Claude desktop connector** are separate yes/no choices.
- Touching **another app's config** (Claude desktop) is off by default and only
  happens on explicit consent — interactively, or with `--with-desktop` in
  non-interactive runs.
- In a non-interactive/piped run **without** `--yes`, it **aborts** rather than
  guess.

Flags: `--dry-run` (preview, change nothing), `--yes` (apply defaults — the flag
*is* your consent), `--with-desktop` (also register the Claude desktop
connector). The shell block is idempotent and re-run-safe; existing files are
backed up to `*.promptwise-bak` first.

## Usage

```bash
promptwise "Could you please kindly help me to parse a CSV in order to save time."
promptwise optimize -f prompt.txt
echo "Kindly explain this simply." | promptwise

promptwise flood ../../examples/conversation.json
promptwise flood conv.json --json

promptwise memory add "We use TypeScript and pnpm." --pin
promptwise memory list
promptwise memory rm <id>
promptwise memory clear

promptwise stats        # lifetime token savings
```

### Flags

| Flag | Meaning |
|------|---------|
| `--surface <browser\|ide\|cli\|desktop>` | hint for persona detection |
| `--host <app>` | host app (vscode, claude-code, …) |
| `--for-model <name>` | flag if that model is overkill for the task (e.g. `--for-model gpt-4o`) |
| `--json` | machine-readable output (great for piping into agents) |

### Use it with coding agents — three modes

Unlike a browser or a closed app, a CLI agent takes your prompt as an argument
or stdin, so you can actually intercept it. From manual to fully automatic:

**1. Manual / piped.** Optimize, then use the result. `--raw` prints *only* the
optimized prompt:

```bash
promptwise "could you please help me refactor this" --raw
# -> Refactor this

# feed it straight to an agent that takes a prompt arg:
myagent "$(promptwise 'could you please summarize the diff' --raw)"

# or via stdin:
echo "could you please explain this error" | promptwise --raw | myagent
```

**2. Wrapper alias (semi-automatic).** Wrap a *one-shot* agent so every call is
optimized first. Add to your shell rc:

```bash
# optimizes the prompt before handing it to the real agent
myagent() { command myagent "$(promptwise "$*" --raw)"; }
```

Now `myagent "could you please ... in order to ..."` auto-optimizes. Add `--llm`
or `--brief` inside the wrapper to also use Ollama / cap the answer.

**3. Prompt hook (fully automatic).** If your agent supports a "before prompt
submit" hook (some coding agents do), point it at `promptwise … --raw` and every
prompt is optimized with no wrapper and no thinking about it — the CLI
equivalent of the browser's auto-suggest.

> Note: wrappers fit **one-shot** agent commands. For **interactive REPL** agents
> (where you type turn after turn), a wrapper can't intercept each turn — use the
> agent's hook if it has one, or run `promptwise session` alongside to optimize +
> track tokens as you go.

Machine-readable output is also available with `--json` (e.g.
`promptwise "<draft>" --json | jq -r '.rewrite.rewritten'`).

Memory and lifetime stats persist under `~/.promptwise/`.
