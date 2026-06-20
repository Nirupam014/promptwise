# PromptWise — Browser Extension

A Manifest V3 extension that overlays the chat composer on ChatGPT, Claude, and
Gemini. As you type, it runs the local rewrite engine and offers a one-click
tighter prompt; it also watches the thread and nudges you to reset when context
floods.

## Load it (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `browser-extension` folder.
4. Open [ChatGPT](https://chatgpt.com), [Claude](https://claude.ai), or
   [Gemini](https://gemini.google.com) and start typing a longish prompt.

A **✦ PromptWise** chip appears above the composer showing the token saving.
Click **Apply** to replace your draft, **ⓘ** to see what changed and a preview,
or **✕** to dismiss.

## Load it in Firefox

Firefox MV3 uses an event-page background (not a service worker) and has no
offscreen API, so it needs a small build and **WebLLM is Chrome-only there**
(Ollama and all heuristic features work).

```bash
npm run build:firefox     # generates packages/browser-extension/dist-firefox/
```

Then: Firefox → `about:debugging#/runtime/this-firefox` → **Load Temporary
Add-on…** → select `dist-firefox/manifest.json`. (Temporary add-ons are removed
when Firefox restarts; re-load after changes.)

## What it does

- **Inline rewrite suggestions** — debounced, non-blocking, dismissible.
- **Context-flood banner** — appears when the thread gets long/repetitive/drifty,
  suggesting you summarize or start fresh.
- **Popup** — on/off toggle per browser, lifetime stats (prompts + tokens saved),
  and full global-memory management (add / pin / remove facts).

## How it's wired

The manifest loads the shared engine (`vendor/core/*.js`, a copy of
`packages/core/src`) in dependency order; each module attaches to
`window.PromptWiseCore`. `src/content.js` then drives the UI. Everything runs
locally in the page — no network calls, no data leaves the browser.

To refresh the vendored engine after changing core:

```bash
cp ../core/src/{tokens,text,protect,memory,persona,rewrite,flood,engine}.js vendor/core/
```

## Files

```
manifest.json          MV3 manifest (matches + script load order)
src/content.js         composer watcher + suggestion/flood UI
src/overlay.css        injected styles (scoped under .pw-)
src/popup.html/.js     toolbar popup: toggle, stats, memory
src/background.js       service worker (seeds defaults)
vendor/core/*.js        copy of the shared engine
```

## Notes

- Site selectors evolve; `content.js` uses a prioritized list of composer
  selectors with fallbacks and rebinds on SPA navigation via a MutationObserver.
- No icons are bundled; Chrome shows a default. Drop 16/48/128px PNGs and an
  `"icons"` block in the manifest to brand it.
