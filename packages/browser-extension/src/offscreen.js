/* PromptWise offscreen document — runs WebLLM (in-browser, WebGPU).
 *
 * Imports WebLLM from a CDN and lazily creates an MLCEngine the first time a
 * completion is requested (the model download is large, so we don't start it
 * just to report status). Communicates with the service worker by message.
 */
import * as webllm from "https://esm.run/@mlc-ai/web-llm";

let engine = null;
let currentModel = null;
let loading = null;

async function ensureEngine(model) {
  if (engine && currentModel === model) return engine;
  if (loading) return loading;
  loading = (async () => {
    engine = await webllm.CreateMLCEngine(model, {
      initProgressCallback: (p) => {
        // surface download progress to anyone listening (e.g. the popup)
        chrome.runtime.sendMessage({ type: "PW_WEBLLM_PROGRESS", progress: p.text || "" }).catch(() => {});
      },
    });
    currentModel = model;
    loading = null;
    return engine;
  })();
  return loading;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== "pw-offscreen") return;

  (async () => {
    try {
      if (msg.cmd === "available") {
        // Report WebGPU availability without forcing a model download.
        sendResponse({ ok: "gpu" in navigator });
        return;
      }
      if (msg.cmd === "complete") {
        const eng = await ensureEngine(msg.model);
        const req = msg.payload || {};
        const messages = [];
        if (req.system) messages.push({ role: "system", content: req.system });
        messages.push({ role: "user", content: req.prompt || "" });
        const payload = { messages, temperature: 0 };
        if (req.json) payload.response_format = { type: "json_object" };
        const res = await eng.chat.completions.create(payload);
        sendResponse({ text: (res.choices && res.choices[0] && res.choices[0].message.content) || "" });
        return;
      }
      sendResponse({ error: "unknown cmd" });
    } catch (e) {
      sendResponse({ error: String((e && e.message) || e) });
    }
  })();

  return true; // async response
});
