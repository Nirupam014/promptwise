# Local LLM integration

PromptWise works fully offline with its heuristic engine. You can *optionally*
add a **local LLM** to get higher-quality rewrites, conversation summaries, and
smarter memory curation — all running on your own machine, so prompts still
never leave your device.

The engine treats every backend through the same interface, and the **heuristic
result is always the verified fallback**: any LLM rewrite that drops code, a URL,
a number, or wanders off-intent is rejected automatically.

> **No model at all?** Even with everything off, "Summarize & save" now produces
> a real **extractive summary** (pure-JS, instant, works in every browser), and
> the heuristic rewrite handles filler/verbose compression. The backends below
> only make those steps *better*.

Pick a backend:

| Backend | Setup | Works in | Notes |
|---------|-------|----------|-------|
| **Chrome built-in AI** | none | Chrome desktop | Uses Chrome's own Gemini Nano; nothing to install or download by us |
| **Ollama** | install + pull model | Chrome + Firefox + IDE | Most powerful; any model size |
| **WebLLM** | vendor the lib (see below) | Chrome + Firefox | Runs in the browser via WebGPU; multi-GB model download on first use |

---

## Option 0 — Chrome built-in AI (zero setup, Chrome only)

If you're on Chrome desktop (138+), pick **Chrome built-in AI** in the popup —
no install, no server, no download from us. It calls Chrome's on-device Gemini
Nano via the Prompt API. The first use may trigger Chrome to download the model
(managed entirely by Chrome). Not available in Firefox.

---

## Option A — Ollama (works in IDE + browser, incl. Firefox)

[Ollama](https://ollama.com) runs a local model server at
`http://localhost:11434`. One model serves every PromptWise surface.

### 1. Install Ollama and pull a model

```bash
# install from https://ollama.com, then:
ollama pull llama3.2:3b      # default; ~2 GB. Smaller: qwen2.5:1.5b
ollama serve                 # if it isn't already running
```

### 2a. VS Code extension

In Settings (`⌘,`) set:

- `promptwise.llm.backend` → `ollama`
- `promptwise.llm.model` → `llama3.2:3b` (or whatever you pulled)

Then select a prompt and run **PromptWise: Deep Optimize with Local LLM**
(`⌘⌥⇧P`). The status bar shows the active model. **Curate Memory with Local
LLM** dedupes and supersedes facts via the model.

### 2b. Browser extension

Browsers call `localhost` from the extension's origin, so Ollama must be told to
allow it. Start Ollama with:

```bash
# macOS / Linux
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
```

On macOS you can make it permanent:

```bash
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
# then restart the Ollama app
```

Then open the PromptWise popup → **Local LLM** → backend **Ollama**. The popup now:

- **Lists your installed models** in a dropdown (pulled from `/api/tags`) — click
  **↻** to refresh. No need to type the model name.
- **Pulls models for you**: type a name (e.g. `qwen2.5:1.5b`) and click **Pull** to
  download it with live progress — no terminal needed.
- **Test connection** confirms `ready · <model>`.

The suggestion chip's **✦ Deep** button now **streams** the rewrite into the
preview as the model generates, and the flood banner offers **Summarize & save**.

---

## Option B — WebLLM (browser only; no install)

[WebLLM](https://github.com/mlc-ai/web-llm) runs the model **entirely inside the
browser** using WebGPU — nothing to install, nothing leaves the tab.

Requirements and caveats:

- A **WebGPU-capable browser** (recent Chrome/Edge). Check `chrome://gpu`.
- The model is **downloaded into the browser on first use** (multiple GB) and
  cached afterward. The first deep optimize will take a while.
- Browser only — the VS Code extension uses Ollama.

**Important — vendoring the library.** MV3 extension pages can't load remote
scripts under the default CSP, so the WebLLM JavaScript library must be bundled
locally at `packages/browser-extension/vendor/webllm/web-llm.js`. Until you do
that, WebLLM won't initialize (the code falls back to a CDN import that the CSP
blocks). To vendor it, download a build of `@mlc-ai/web-llm` and place its ESM
bundle at that path. The model *weights* still download at runtime (that's a
`fetch`, which is allowed) — only the library needs to be local.

How it runs: in **Chrome** the model runs in an MV3 *offscreen document* (the
service worker has no WebGPU); in **Firefox** it runs directly in the background
event page (which has WebGPU). Either way, enable it in the popup → backend
**WebLLM**, then **✦ Deep** loads it lazily on first use.

> WebLLM is the heaviest and least-polished path. For zero-setup use Chrome
> built-in AI (Chrome) or the pure-JS summarizer (everywhere); for the best
> quality use Ollama.

---

## What the LLM is used for

| Job | Heuristic (always) | With a local LLM |
|-----|--------------------|------------------|
| Rewrite | remove filler, simplify phrases, drop known context | genuinely re-express more compactly, verified safe |
| Summarize-and-reset | extract durable facts by keyword | a real summary + cleaner fact list |
| Memory curation | add + Jaccard dedupe | semantic dedupe **and** supersede outdated facts |

## Picking a model

- `llama3.2:3b` — good default, solid quality.
- `qwen2.5:1.5b` — faster/lighter, still strong at rewriting.
- Larger models improve summaries and memory reasoning at the cost of latency.

## Privacy

Both backends are local. Ollama runs on `localhost`; WebLLM runs in the page.
PromptWise makes no third-party API calls for inference. The only network
traffic is the one-time model download (Ollama pull, or WebLLM's in-browser
fetch from the CDN).
