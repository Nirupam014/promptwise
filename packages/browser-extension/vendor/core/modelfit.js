/**
 * modelfit.js — flag using an expensive model for a cheap task.
 *
 * Two pieces:
 *   1. a model registry mapping model ids to relative COST TIERS (1 cheap/fast,
 *      2 mid, 3 frontier) and a cheaper sibling in the same family;
 *   2. a heuristic that estimates a prompt's TASK COMPLEXITY (0..1).
 *
 * If a high-tier model is paired with a low-complexity task, we nudge toward a
 * cheaper model. The registry is deliberately approximate and user-overridable
 * (model lineups change); it's a hint, not a verdict.
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});
  var tokens = isNode ? require("./tokens.js") : PW.tokens;

  // Order matters: more specific patterns first (mini/flash/haiku before the
  // frontier patterns). cheap = a fast/cheap sibling; mid = a mid sibling.
  var REGISTRY = [
    { re: /gpt-4o-mini|gpt-4\.1-mini|gpt-4o-nano|gpt-3\.5/i, family: "OpenAI", tier: 1 },
    { re: /o[134](?:-mini)?\b/i, family: "OpenAI", tier: 3, cheap: "gpt-4o-mini" },
    { re: /gpt-4o|gpt-4\.1|gpt-4\b|chatgpt-4o/i, family: "OpenAI", tier: 3, cheap: "gpt-4o-mini" },

    { re: /claude.*haiku|haiku/i, family: "Anthropic", tier: 1 },
    { re: /claude.*sonnet|sonnet/i, family: "Anthropic", tier: 2, cheap: "Claude Haiku" },
    { re: /claude.*opus|opus/i, family: "Anthropic", tier: 3, cheap: "Claude Haiku", mid: "Claude Sonnet" },

    { re: /gemini.*flash|flash/i, family: "Google", tier: 1 },
    { re: /gemini.*(pro|ultra)|gemini-1\.5-pro|gemini-2/i, family: "Google", tier: 3, cheap: "Gemini Flash" },

    { re: /(llama3?\.?2?|qwen2?\.?5?|phi|gemma|mistral).*(0\.5b|1\.5b|:1b|:3b|mini|small)/i, family: "local", tier: 1 },
    { re: /(llama|qwen|mixtral|command-?r).*(70b|72b|405b|large)/i, family: "local", tier: 2, cheap: "a smaller local model" },
  ];

  function lookup(model) {
    if (!model) return null;
    for (var i = 0; i < REGISTRY.length; i++) {
      if (REGISTRY[i].re.test(model)) return REGISTRY[i];
    }
    return null;
  }

  // Global flags so we can COUNT matches (multiple signals stack).
  var COMPLEX_RE = /\b(architecture|design|refactor|debug|optimi[sz]e|prove|algorithm|trade-?offs?|step[- ]by[- ]step|reason(?:ing)?|analy[sz]e|in depth|implement|migrate|root cause|concurren|distributed|security|benchmark)\b/gi;
  var SIMPLE_RE = /\b(rename|reformat|format|fix typo|typos?|spell(?:ing)?|grammar|translate|what is|who is|define|definition|list|convert|tl;?dr|capitali[sz]e|lower[- ]?case|upper[- ]?case|rephrase|shorten)\b/gi;
  var CODE_RE = /```|\b(function|class|=>|def |import |const |async )\b/;

  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function count(re, s) { return (s.match(re) || []).length; }

  /** Estimate task complexity 0..1 from the prompt text. */
  function taskComplexity(prompt) {
    prompt = prompt || "";
    var tk = tokens.estimateTokens(prompt);
    var score = 0.3; // neutral baseline
    if (tk > 400) score += 0.35;
    else if (tk > 150) score += 0.18;
    else if (tk < 30) score -= 0.18;

    if (CODE_RE.test(prompt)) score += 0.2;
    score += Math.min(0.45, count(COMPLEX_RE, prompt) * 0.18); // stack complex signals
    score -= Math.min(0.3, count(SIMPLE_RE, prompt) * 0.3);

    var qs = count(/\?/g, prompt);
    if (qs >= 3) score += 0.15;

    return clamp(score);
  }

  function label(c) { return c < 0.34 ? "simple" : c < 0.66 ? "moderate" : "complex"; }

  /**
   * Assess whether `model` is overkill for `prompt`.
   * @returns {{ known, model, family, tier, complexity, complexityLabel, overkill, suggestion, message }}
   */
  function assess(input) {
    input = input || {};
    var model = input.model || "";
    var prompt = input.prompt || "";
    var entry = lookup(model);
    var complexity = taskComplexity(prompt);
    var lbl = label(complexity);

    var base = {
      known: !!entry,
      model: model,
      family: entry ? entry.family : "unknown",
      tier: entry ? entry.tier : 0,
      complexity: Math.round(complexity * 100) / 100,
      complexityLabel: lbl,
      overkill: false,
      suggestion: null,
      message: null,
    };
    if (!entry) return base;

    var suggestion = null;
    if (entry.tier === 3 && complexity < 0.34) suggestion = entry.cheap || null;
    else if (entry.tier === 3 && complexity < 0.6) suggestion = entry.mid || entry.cheap || null;
    else if (entry.tier === 2 && complexity < 0.25) suggestion = entry.cheap || null;

    if (suggestion) {
      base.overkill = true;
      base.suggestion = suggestion;
      base.message =
        "This looks like a " + lbl + " task — " + (model || "this model") +
        " may be overkill. Consider " + suggestion + " to cut cost.";
    }
    return base;
  }

  var api = { assess: assess, taskComplexity: taskComplexity, REGISTRY: REGISTRY, lookup: lookup };
  PW.modelfit = api;
  if (isNode) module.exports = api;
})();
