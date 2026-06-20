/* PromptWise service worker — seeds defaults and routes LLM requests.
 *
 * The content script never talks to the model directly. It sends messages here;
 * this worker builds the right provider (Ollama via fetch, or WebLLM via an
 * offscreen document with WebGPU) and runs the core engine's LLM methods.
 *
 * Loading Ollama from the extension origin requires Ollama to allow it, e.g.
 *   OLLAMA_ORIGINS="chrome-extension://*" ollama serve
 */

// Load the shared engine into the worker scope.
// Chrome runs this as an MV3 service worker (only background.js is loaded), so we
// importScripts the engine here. Firefox runs it as an event page where the
// vendor scripts are listed ahead of this file in manifest background.scripts —
// so PromptWiseCore already exists and importScripts must be skipped.
if (typeof self.PromptWiseCore === "undefined" && typeof importScripts === "function") {
  importScripts(
    chrome.runtime.getURL("vendor/core/tokens.js"),
    chrome.runtime.getURL("vendor/core/text.js"),
    chrome.runtime.getURL("vendor/core/protect.js"),
    chrome.runtime.getURL("vendor/core/memory.js"),
    chrome.runtime.getURL("vendor/core/persona.js"),
    chrome.runtime.getURL("vendor/core/brevity.js"),
    chrome.runtime.getURL("vendor/core/summarize.js"),
    chrome.runtime.getURL("vendor/core/modelfit.js"),
    chrome.runtime.getURL("vendor/core/rewrite.js"),
    chrome.runtime.getURL("vendor/core/flood.js"),
    chrome.runtime.getURL("vendor/core/engine.js"),
    chrome.runtime.getURL("vendor/core/llm/provider.js"),
    chrome.runtime.getURL("vendor/core/llm/tasks.js"),
    chrome.runtime.getURL("vendor/core/llm/ollama.js"),
    chrome.runtime.getURL("vendor/core/llm/webllm.js"),
    chrome.runtime.getURL("vendor/core/llm/chromeai.js")
  );
}

var PWC = self.PromptWiseCore;

var DEFAULT_LLM = {
  backend: "off", // "off" | "ollama" | "webllm"
  endpoint: "http://localhost:11434",
  ollamaModel: "llama3.2:3b",
  webllmModel: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
};

chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.get(["pw_enabled", "pw_memory", "pw_stats", "pw_llm"], function (res) {
    var patch = {};
    if (res.pw_enabled === undefined) patch.pw_enabled = true;
    if (!res.pw_memory) patch.pw_memory = [];
    if (!res.pw_stats) patch.pw_stats = { promptsOptimized: 0, tokensSaved: 0 };
    if (!res.pw_llm) patch.pw_llm = DEFAULT_LLM;
    if (Object.keys(patch).length) chrome.storage.local.set(patch);
  });
});

function getState() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(["pw_llm", "pw_memory"], function (res) {
      var settings = Object.assign({}, DEFAULT_LLM, res.pw_llm || {});
      var pw = new PWC.engine.PromptWise();
      (res.pw_memory || []).forEach(function (f) { pw.memory.add(f.text || f, { pinned: f.pinned }); });
      resolve({ settings: settings, pw: pw });
    });
  });
}

// ---- WebLLM via offscreen document ----
var creating = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: "src/offscreen.html",
      reasons: ["WORKERS"],
      justification: "Run a local in-browser LLM (WebLLM/WebGPU) for prompt optimization.",
    });
  }
  await creating;
  creating = null;
}

function offscreenCall(cmd, payload, model) {
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage({ target: "pw-offscreen", cmd: cmd, payload: payload, model: model }, function (resp) {
      if (chrome.runtime.lastError) return resolve({ error: chrome.runtime.lastError.message });
      resolve(resp || { error: "no response" });
    });
  });
}

// ---- Firefox-direct WebLLM (background event page has DOM + WebGPU) ----
var ffEngine = null;
var ffLoading = null;
async function ffEnsureEngine(model) {
  if (ffEngine) return ffEngine;
  if (ffLoading) return ffLoading;
  ffLoading = (async function () {
    // Prefer a locally vendored web-llm bundle (MV3 extension pages can't load
    // remote scripts under the default CSP). Falls back to the CDN where the
    // environment allows it (dev / relaxed CSP).
    var webllm;
    try {
      webllm = await import(chrome.runtime.getURL("vendor/webllm/web-llm.js"));
    } catch (e) {
      webllm = await import("https://esm.run/@mlc-ai/web-llm");
    }
    ffEngine = await webllm.CreateMLCEngine(model);
    return ffEngine;
  })();
  return ffLoading;
}

function buildProvider(settings) {
  if (settings.backend === "ollama") {
    return PWC.llm.ollama.createOllamaProvider({ endpoint: settings.endpoint, model: settings.ollamaModel });
  }
  if (settings.backend === "chromeai") {
    return PWC.llm.chromeai.createChromeAIProvider();
  }
  if (settings.backend === "webllm") {
    var model = settings.webllmModel;
    var firefox = !chrome.offscreen; // Firefox event page runs WebLLM directly
    return {
      info: function () { return { backend: "webllm", model: model }; },
      available: async function () {
        if (!("gpu" in navigator)) return false;
        if (firefox) return true; // background page has WebGPU
        await ensureOffscreen();
        var r = await offscreenCall("available", null, model);
        return !!(r && r.ok);
      },
      complete: async function (req) {
        if (firefox) {
          var eng = await ffEnsureEngine(model);
          var messages = [];
          if (req.system) messages.push({ role: "system", content: req.system });
          messages.push({ role: "user", content: req.prompt || "" });
          var payload = { messages: messages, temperature: 0 };
          if (req.json) payload.response_format = { type: "json_object" };
          var res = await eng.chat.completions.create(payload);
          return (res.choices && res.choices[0] && res.choices[0].message.content) || "";
        }
        await ensureOffscreen();
        var r = await offscreenCall("complete", req, model);
        if (!r || r.error) throw new Error((r && r.error) || "webllm error");
        return r.text;
      },
    };
  }
  return null;
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.target === "pw-offscreen") return; // not for the worker
  if (!msg.type || msg.type.indexOf("PW_") !== 0) return;

  (async function () {
    var state = await getState();
    var settings = state.settings;
    var pw = state.pw;

    try {
      if (msg.type === "PW_LLM_STATUS") {
        var p = buildProvider(settings);
        if (!p) return sendResponse({ backend: "off", ready: false });
        // Rich diagnosis for Ollama (down vs blocked vs model-missing).
        if (settings.backend === "ollama" && typeof p.diagnose === "function") {
          var origin = chrome.runtime.getURL("").replace(/\/+$/, "");
          var d = await p.diagnose(settings.ollamaModel);
          return sendResponse(
            Object.assign({ backend: "ollama", model: settings.ollamaModel, origin: origin }, d, {
              ready: !!(d.reachable && d.allowed && d.hasModel),
            })
          );
        }
        var ok = await p.available();
        return sendResponse({ backend: settings.backend, model: p.info().model, ready: ok });
      }

      if (msg.type === "PW_OPTIMIZE_LLM") {
        pw.setProvider(buildProvider(settings));
        var out = await pw.optimizeWithLLM({
          prompt: msg.prompt,
          context: msg.context || [],
          signals: { surface: "browser", hostApp: msg.host },
        });
        return sendResponse(out);
      }

      if (msg.type === "PW_SUMMARIZE") {
        pw.setProvider(buildProvider(settings));
        var res = await pw.summarizeThread(msg.messages || []);
        return sendResponse(res);
      }

      if (msg.type === "PW_OLLAMA_MODELS") {
        var prov = buildProvider(settings);
        if (!prov || typeof prov.listModels !== "function") return sendResponse({ models: [] });
        var models = await prov.listModels();
        return sendResponse({ models: models });
      }

      sendResponse({ error: "unknown message type" });
    } catch (e) {
      sendResponse({ error: String((e && e.message) || e) });
    }
  })();

  return true; // keep the channel open for the async response
});

// Long-lived ports for streaming: Deep optimize (token stream) and model pull
// (download progress).
chrome.runtime.onConnect.addListener(function (port) {
  if (port.name === "pw-deep") {
    port.onMessage.addListener(function (msg) {
      (async function () {
        var state = await getState();
        var pw = state.pw;
        pw.setProvider(buildProvider(state.settings));
        try {
          var out = await pw.optimizeWithLLMStream(
            { prompt: msg.prompt, context: msg.context || [], signals: { surface: "browser", hostApp: msg.host } },
            function (token, full) { try { port.postMessage({ token: token, full: full }); } catch (e) {} }
          );
          port.postMessage({ done: true, result: out });
        } catch (e) {
          port.postMessage({ done: true, error: String((e && e.message) || e) });
        }
      })();
    });
  } else if (port.name === "pw-pull") {
    port.onMessage.addListener(function (msg) {
      (async function () {
        var state = await getState();
        var prov = buildProvider(state.settings);
        if (!prov || typeof prov.pull !== "function") {
          return port.postMessage({ done: true, error: "Model pull is only supported with the Ollama backend." });
        }
        try {
          await prov.pull(msg.model, function (p) { try { port.postMessage({ progress: p }); } catch (e) {} });
          port.postMessage({ done: true });
        } catch (e) {
          port.postMessage({ done: true, error: String((e && e.message) || e) });
        }
      })();
    });
  }
});
