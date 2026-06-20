/**
 * index.js — public entry point for the PromptWise core.
 * Requiring this loads every module and exposes the full API. In the browser
 * the same modules attach to window.PromptWiseCore (load order: tokens, text,
 * protect, memory, persona, rewrite, flood, engine, then the llm/* modules).
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});

  if (isNode) {
    require("./tokens.js");
    require("./text.js");
    require("./protect.js");
    require("./memory.js");
    require("./persona.js");
    require("./brevity.js");
    require("./summarize.js");
    require("./modelfit.js");
    require("./rewrite.js");
    require("./flood.js");
    require("./engine.js");
    require("./llm/provider.js");
    require("./llm/tasks.js");
    require("./llm/ollama.js");
    require("./llm/webllm.js");
    require("./llm/chromeai.js");
  }

  var api = {
    PromptWise: PW.engine.PromptWise,
    Memory: PW.memory.Memory,
    rewrite: PW.rewrite.rewrite,
    analyzeFlood: PW.flood.analyze,
    detectPersona: PW.persona.detect,
    estimateTokens: PW.tokens.estimateTokens,
    assessModel: function (model, prompt) { return PW.modelfit.assess({ model: model, prompt: prompt }); },
    // LLM layer
    createOllamaProvider: PW.llm.ollama.createOllamaProvider,
    createWebLLMProvider: PW.llm.webllm.createWebLLMProvider,
    createChromeAIProvider: PW.llm.chromeai.createChromeAIProvider,
    llmTasks: PW.llm.tasks,
    verifyRewrite: PW.llm.provider.verifyRewrite,
    version: "1.0.0",
  };
  PW.index = api;
  if (isNode) module.exports = api;
})();
