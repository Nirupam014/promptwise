/**
 * brevity.js — output-token control.
 *
 * Compression saves INPUT tokens; this saves OUTPUT tokens by appending a short
 * directive that caps the model's answer length and strips preamble. It's the
 * only direct lever on output cost. Opt-in via the engine's `outputBudget`.
 *
 *   outputBudget: true            -> persona default directive
 *   outputBudget: { words: 120, noPreamble: true, style: "bullets"|"prose" }
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});

  var PERSONA_DEFAULTS = {
    developer: { words: 0, noPreamble: true, lead: "Code first, minimal prose." },
    "analyst-writer": { words: 0, noPreamble: true, lead: "" },
    "power-chatter": { words: 120, noPreamble: true, lead: "" },
    generic: { words: 120, noPreamble: true, lead: "" },
  };

  function directiveFor(persona, budget) {
    if (!budget) return null;
    var key = persona && persona.persona ? persona.persona : "generic";
    var base = PERSONA_DEFAULTS[key] || PERSONA_DEFAULTS.generic;
    var cfg = budget === true ? {} : budget || {};
    var words = cfg.words != null ? cfg.words : base.words;
    var noPreamble = cfg.noPreamble != null ? cfg.noPreamble : base.noPreamble;
    var style = cfg.style || "";

    var parts = [];
    if (noPreamble) parts.push("no preamble, don't restate the question");
    if (words && words > 0) parts.push("answer in ≤" + words + " words");
    if (style === "bullets") parts.push("use terse bullet points");
    if (style === "prose") parts.push("use short prose");
    if (base.lead) parts.push(base.lead.toLowerCase().replace(/\.$/, ""));
    if (!parts.length) parts.push("be concise");

    // Capitalize first letter; single compact line.
    var s = parts.join("; ");
    return s.charAt(0).toUpperCase() + s.slice(1) + ".";
  }

  var api = { directiveFor: directiveFor, PERSONA_DEFAULTS: PERSONA_DEFAULTS };
  PW.brevity = api;
  if (isNode) module.exports = api;
})();
