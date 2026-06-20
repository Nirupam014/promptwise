# @promptwise-dev/core

The shared engine behind every PromptWise surface. Zero dependencies; the same
files run in Node (`require`) and the browser (each module attaches to
`window.PromptWiseCore`).

## Modules

| File | Responsibility |
|------|----------------|
| `tokens.js` | model-agnostic token estimation |
| `text.js` | normalization, sentence splitting, Jaccard similarity |
| `protect.js` | mask code blocks / inline code / URLs so they survive rewriting |
| `rewrite.js` | the heuristic rewrite engine |
| `flood.js` | context-flood scoring + reset/summarize recommendation |
| `memory.js` | durable-fact store with dedup and relevance lookup |
| `persona.js` | per-surface persona & task inference |
| `engine.js` | `PromptWise` façade used by adapters |
| `index.js` | public entry point (`require("./src/index.js")`) |

## API

```js
const { PromptWise, Memory, rewrite, analyzeFlood, detectPersona, estimateTokens } =
  require("./src/index.js");

const pw = new PromptWise();
pw.memory.add("We use TypeScript and pnpm.");

const out = pw.optimize({
  prompt: "Could you please just set up a TS build using pnpm.",
  context: [/* visible turns: strings or {role, content} */],
  signals: { surface: "ide", hostApp: "vscode", fileTypes: ["typescript"] },
});
// out.rewrite.{rewritten, tokensSaved, percentSaved, changes, constraintsPreserved}
// out.persona.{persona, confidence, task, tailoring}
// out.suggestion.{headline, rewritten, reasons}

const flood = analyzeFlood(messages); // {recommendation, severity, signals, message, carryToMemory}
```

## Guarantees

- Rewrites **never** exceed the original token count (safety fallback returns the
  original unchanged).
- Code blocks, inline code, URLs, and numbers are preserved verbatim.
- Pure functions where possible; the only state is the `Memory` instance and the
  engine's running `stats`.

## Test

```bash
node --test test
```
