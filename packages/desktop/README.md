# PromptWise — Desktop companion (experimental)

> **Status: experimental.** This surface works but is intentionally unpolished —
> no packaging, signing, or auto-update — and it's the least-tested of the
> PromptWise surfaces. The supported surfaces are the browser extension, IDE
> extension, CLI, and the MCP connector. Use this if you specifically want a
> system-wide hotkey for the *native* desktop AI apps.

A menu-bar / tray app that optimizes prompts for the **Claude, ChatGPT, and
Gemini desktop apps** — and anything else you type into.

Those desktop apps are closed (Electron) apps you can't extend like a browser,
so PromptWise works *alongside* them: press a global hotkey, a small optimizer
pops up, it rewrites your prompt (heuristic + optional local Ollama) and copies
the result back to your clipboard so you paste it wherever you want.

## How it works

1. Copy (or start typing) your draft prompt.
2. Press **⌘⇧Space** (macOS) / **Ctrl+Shift+Space** — a floating window appears,
   pre-filled from your clipboard.
3. Click **Optimize** (instant heuristic) or **Optimize with LLM** (streams from
   Ollama). Toggle **brief answer** to also cap the model's output length.
4. Click **Copy & close** and paste into Claude / ChatGPT / Gemini.

The whole thing runs locally — the engine is `@promptwise-dev/core`, and the
optional model is your own Ollama. Nothing leaves your machine.

## Run it

```bash
# from the repo root (installs electron + links the core)
npm install
npm start --workspace @promptwise-dev/desktop
# or: cd packages/desktop && npm install && npm start
```

> Requires [Electron](https://www.electronjs.org/) (listed as a devDependency).
> First `npm install` downloads it.

## Local LLM (optional)

Click the **⚙** gear → set backend to **Ollama**, endpoint, and model. The
status pill shows the connection state (it reuses the core's Ollama diagnosis:
offline / blocked / model-missing / ready). For Ollama setup and
`OLLAMA_ORIGINS` notes, see [../../docs/LOCAL-LLM.md](../../docs/LOCAL-LLM.md).
(Desktop fetches come from the app's own process, not a browser, so the
`OLLAMA_ORIGINS` browser-extension caveat doesn't apply here.)

## Architecture

- `main.js` — Electron main process: tray, global hotkey, window, and all engine
  calls (heuristic + Ollama). The renderer never touches Node directly.
- `preload.js` — a locked-down `contextBridge` exposing a tiny `window.pw` API.
- `renderer/` — the floating UI (no Node access; CSP-locked).
- Settings persist in the app's userData folder.

## Notes

- macOS: it runs as a menu-bar app (no Dock icon).
- The hotkey is `CommandOrControl+Shift+Space`; change it in `main.js` if it
  clashes with Spotlight or another app.
- This package is not published to npm; it's run/packaged from source. To ship a
  signed installer, wrap it with `electron-builder` (not included).
