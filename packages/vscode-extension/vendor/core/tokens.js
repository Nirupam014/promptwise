/**
 * tokens.js — token estimation.
 *
 * Heuristic, model-agnostic token estimator. We avoid shipping a full BPE
 * tokenizer (heavy, model-specific) and instead blend two cheap signals that
 * track real tokenizers closely enough for savings estimates:
 *   - characters / 4   (OpenAI's published rule of thumb)
 *   - words * 1.33     (sub-word splitting factor)
 *
 * Runs identically in Node and the browser (no dependencies).
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});

  function estimateTokens(text) {
    if (!text) return 0;
    var chars = text.length;
    var words = (text.match(/\S+/g) || []).length;
    var blended = (chars / 4 + words * 1.33) / 2;
    return Math.max(1, Math.round(blended));
  }

  /** Estimate tokens across an array of {content} or strings. */
  function estimateTotal(items) {
    if (!items) return 0;
    return items.reduce(function (sum, it) {
      var s = typeof it === "string" ? it : it && it.content ? it.content : "";
      return sum + estimateTokens(s);
    }, 0);
  }

  var api = { estimateTokens: estimateTokens, estimateTotal: estimateTotal };
  PW.tokens = api;
  if (isNode) module.exports = api;
})();
