/**
 * llm/tasks.js — the three LLM-powered jobs, expressed purely in terms of a
 * provider's `complete()`. Transport-agnostic, so they're testable with a fake
 * provider and run identically against Ollama or WebLLM.
 *
 *   rewrite(provider, prompt, ctx)        -> cleaned rewrite string
 *   summarize(provider, messages)         -> { summary, facts[] }
 *   curateMemory(provider, existing, new) -> { facts[], removed[] }
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});
  var prov = isNode ? require("./provider.js") : PW.llm.provider;

  function asText(items, pick) {
    return (items || [])
      .map(function (it) { return typeof it === "string" ? it : pick(it); })
      .filter(Boolean);
  }

  var REWRITE_SYSTEM =
    "You are a prompt compressor. Rewrite the user's prompt to use as few tokens " +
    "as possible while preserving the EXACT intent and every hard constraint. " +
    "Keep all code, URLs, numbers, file names, and named entities verbatim. " +
    "Remove politeness, filler, hedging, and anything the assistant already knows " +
    "(listed under KNOWN). Do not answer the prompt. Do not add notes. " +
    "Output ONLY the rewritten prompt text.";

  function buildRewriteUser(prompt, ctx) {
    ctx = ctx || {};
    var known = []
      .concat(asText(ctx.context, function (m) { return m.content; }))
      .concat(asText(ctx.memory, function (m) { return m.text; }));
    var persona = ctx.persona && ctx.persona.persona ? ctx.persona.persona : null;
    var user = "";
    if (known.length) {
      user += "KNOWN (the assistant already has this — don't repeat it):\n";
      user += known.map(function (k) { return "- " + k; }).join("\n") + "\n\n";
    }
    if (persona) user += "AUDIENCE: " + persona + "\n\n";
    user += "ORIGINAL PROMPT:\n" + prompt + "\n\nREWRITTEN PROMPT:";
    return user;
  }

  function rewrite(provider, prompt, ctx) {
    return provider
      .complete({ system: REWRITE_SYSTEM, prompt: buildRewriteUser(prompt, ctx) })
      .then(function (out) { return prov.cleanRewrite(out); });
  }

  /** Streaming rewrite: onToken(chunk, full) fires as tokens arrive. */
  function rewriteStream(provider, prompt, ctx, onToken) {
    if (typeof provider.completeStream !== "function") {
      return rewrite(provider, prompt, ctx);
    }
    return provider
      .completeStream({ system: REWRITE_SYSTEM, prompt: buildRewriteUser(prompt, ctx) }, onToken)
      .then(function (full) { return prov.cleanRewrite(full); });
  }

  var SUMMARY_SYSTEM =
    "You compress conversations. Given a transcript, return STRICT JSON with two " +
    'keys: "summary" (a concise paragraph preserving all decisions, constraints, ' +
    'and open tasks) and "facts" (an array of short, durable, reusable facts worth ' +
    "remembering — preferences, stack, names, requirements). Return only JSON.";

  function summarize(provider, messages) {
    var transcript = (messages || [])
      .map(function (m) { return (m.role || "user").toUpperCase() + ": " + (m.content || ""); })
      .join("\n");
    return provider
      .complete({ system: SUMMARY_SYSTEM, prompt: transcript, json: true })
      .then(function (out) {
        var parsed = prov.parseJSONLoose(out) || {};
        return {
          summary: typeof parsed.summary === "string" ? parsed.summary : null,
          facts: Array.isArray(parsed.facts) ? parsed.facts.filter(function (f) { return typeof f === "string"; }) : [],
        };
      });
  }

  var CURATE_SYSTEM =
    "You maintain a user's long-term memory of durable facts. Merge EXISTING facts " +
    "with NEW candidate facts into a deduplicated, up-to-date list. If a new fact " +
    "updates or contradicts an old one, keep the new and drop the old. Keep facts " +
    'short. Return STRICT JSON: {"facts": [strings], "removed": [strings]}. Only JSON.';

  function curateMemory(provider, existing, candidates) {
    var user =
      "EXISTING:\n" +
      asText(existing, function (m) { return m.text; }).map(function (f) { return "- " + f; }).join("\n") +
      "\n\nNEW:\n" +
      asText(candidates, function (m) { return m.text; }).map(function (f) { return "- " + f; }).join("\n");
    return provider
      .complete({ system: CURATE_SYSTEM, prompt: user, json: true })
      .then(function (out) {
        var parsed = prov.parseJSONLoose(out) || {};
        return {
          facts: Array.isArray(parsed.facts) ? parsed.facts.filter(function (f) { return typeof f === "string"; }) : null,
          removed: Array.isArray(parsed.removed) ? parsed.removed : [],
        };
      });
  }

  var api = { rewrite: rewrite, rewriteStream: rewriteStream, summarize: summarize, curateMemory: curateMemory };
  PW.llm = PW.llm || {};
  PW.llm.tasks = api;
  if (isNode) module.exports = api;
})();
