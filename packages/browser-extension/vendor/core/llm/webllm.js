/**
 * llm/webllm.js — provider adapter for an in-browser WebLLM engine (WebGPU).
 *
 * WebLLM (@mlc-ai/web-llm) loads and runs the model entirely inside the
 * browser. The heavy lifting — importing the library from a CDN, downloading
 * the model, and creating the MLCEngine — happens in the extension (an
 * offscreen document), because it needs WebGPU and a large download. This
 * adapter is a thin, dependency-free wrapper around an already-created engine
 * so the core stays loadable everywhere and unit-testable.
 *
 *   createWebLLMProvider({ engine, model })
 *   - engine: an MLCEngine-like object exposing
 *       engine.chat.completions.create({ messages, temperature, response_format })
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});

  function createWebLLMProvider(opts) {
    opts = opts || {};
    var engine = opts.engine;
    var model = opts.model || "Llama-3.2-3B-Instruct-q4f16_1-MLC";
    var temperature = opts.temperature == null ? 0 : opts.temperature;

    function info() {
      return { backend: "webllm", model: model };
    }

    function available() {
      return Promise.resolve(!!engine && !!engine.chat && !!engine.chat.completions);
    }

    function complete(req) {
      req = req || {};
      if (!engine) return Promise.reject(new Error("WebLLM engine not initialized"));
      var messages = [];
      if (req.system) messages.push({ role: "system", content: req.system });
      messages.push({ role: "user", content: req.prompt || "" });
      var payload = { messages: messages, temperature: temperature };
      if (req.json) payload.response_format = { type: "json_object" };
      return engine.chat.completions.create(payload).then(function (res) {
        try {
          return res.choices[0].message.content || "";
        } catch (e) {
          return "";
        }
      });
    }

    return { info: info, available: available, complete: complete };
  }

  var api = { createWebLLMProvider: createWebLLMProvider };
  PW.llm = PW.llm || {};
  PW.llm.webllm = api;
  if (isNode) module.exports = api;
})();
