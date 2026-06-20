/**
 * llm/chromeai.js — provider adapter for Chrome's built-in on-device AI.
 *
 * Chrome ships Gemini Nano and exposes it via the Prompt API (global
 * `LanguageModel`) — the model is downloaded and managed by Chrome itself, so
 * there's nothing for us to bundle and no server to run. This is the cleanest
 * "no Ollama, zero setup" path, but it's Chrome-only desktop. Available in
 * extension contexts (service worker / background), which is where we use it.
 *
 *   createChromeAIProvider()
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});

  function getLM(g) {
    return g.LanguageModel || (g.ai && g.ai.languageModel) || null;
  }

  function createChromeAIProvider(opts) {
    opts = opts || {};
    var g = root;

    function info() {
      return { backend: "chromeai", model: "gemini-nano" };
    }

    function available() {
      var LM = getLM(g);
      if (!LM || typeof LM.create !== "function") return Promise.resolve(false);
      if (typeof LM.availability !== "function") return Promise.resolve(true);
      return Promise.resolve()
        .then(function () { return LM.availability(); })
        .then(function (a) {
          // "available" | "downloadable" | "downloading" (older: "readily" | true)
          return a === "available" || a === "downloadable" || a === "downloading" || a === "readily" || a === true;
        })
        .catch(function () { return true; });
    }

    function complete(req) {
      req = req || {};
      var LM = getLM(g);
      if (!LM) return Promise.reject(new Error("Chrome built-in AI (Prompt API) is unavailable"));
      var createOpts = {};
      if (req.system) createOpts.initialPrompts = [{ role: "system", content: req.system }];
      return Promise.resolve()
        .then(function () { return LM.create(createOpts); })
        .then(function (session) {
          return Promise.resolve(session.prompt(req.prompt || "")).then(function (out) {
            try { if (session.destroy) session.destroy(); } catch (e) {}
            return out || "";
          });
        });
    }

    return { info: info, available: available, complete: complete };
  }

  var api = { createChromeAIProvider: createChromeAIProvider };
  PW.llm = PW.llm || {};
  PW.llm.chromeai = api;
  if (isNode) module.exports = api;
})();
