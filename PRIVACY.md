# Privacy Policy — PromptWise

_Last updated: 2026-06-20_

**PromptWise does not collect, store on our servers, transmit, sell, or share
any personal data. We have no servers and run no analytics.** Everything happens
locally on your device.

## What PromptWise does with your text

PromptWise reads the prompt you type into the supported AI chat sites
(chatgpt.com, chat.openai.com, claude.ai, gemini.google.com) **solely to generate
a shorter, lower-token suggestion locally in your browser**. Your prompt is not
sent to us or to any third party. The suggestion is shown to you; nothing is
submitted on your behalf.

## Data stored on your device

The following are saved only in your browser's local storage
(`chrome.storage.local`) and never leave your device:

- your settings (on/off, token-saving and local-LLM preferences, model choice);
- your saved "memory" facts (used to avoid re-sending the same context);
- a local count of prompts optimized and tokens saved.

You can view, edit, or clear all of this from the extension popup at any time.

## Optional local AI (off by default)

- **Ollama** — if you enable it, your prompt is sent to a server running on your
  own machine (`localhost:11434`). It never leaves your computer.
- **WebLLM** — if you enable it, the model runs entirely inside your browser. The
  model and library files are downloaded once from public CDNs (e.g. esm.run,
  jsDelivr, Hugging Face); your prompts are not uploaded.
- **Chrome built-in AI** — if you enable it, your prompt is processed by Chrome's
  on-device Gemini Nano. It does not leave the browser.

## What we do NOT do

- No analytics, telemetry, tracking, fingerprinting, or advertising.
- No accounts, no remote storage, no third-party data sharing.
- No selling or transfer of any data.

## Permissions, briefly

- **storage** — save your settings and memory locally.
- **host access** to the four AI chat sites — read your draft prompt to suggest a
  shorter one.
- **localhost / CDN host access, offscreen** — used only for the optional
  local-LLM features described above.

## Contact

Questions or reports: open an issue or a private advisory at
<https://github.com/Nirupam014/promptwise>.

## Changes

Any updates to this policy will be published in this file.
