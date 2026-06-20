/**
 * llm/provider.js — shared LLM helpers: guardrail verification, output
 * cleaning, tolerant JSON parsing, and a rewrite-result builder.
 *
 * A "provider" is any object with:
 *   info()      -> { backend, model }
 *   available() -> Promise<boolean>
 *   complete({ system, prompt, json }) -> Promise<string>
 *
 * The Ollama and WebLLM adapters implement that contract; everything else in
 * the LLM layer is transport-agnostic and depends only on `complete`.
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});
  var tokens = isNode ? require("../tokens.js") : PW.tokens;
  var text = isNode ? require("../text.js") : PW.text;

  // Spans an LLM rewrite must keep verbatim (mirrors protect.js).
  var SPAN_RES = [/```[\s\S]*?```/g, /`[^`\n]+`/g, /https?:\/\/[^\s)]+/g];
  var NUM_RE = /\d+(?:\.\d+)?/g;

  function matchesAll(needles, haystack) {
    for (var i = 0; i < needles.length; i++) {
      if (haystack.indexOf(needles[i]) === -1) return needles[i];
    }
    return null;
  }

  function collect(re, str) {
    var out = [];
    var m;
    re.lastIndex = 0;
    while ((m = re.exec(str)) !== null) out.push(m[0]);
    return out;
  }

  /**
   * Decide whether an LLM rewrite is safe to use. Returns { ok, reason }.
   * Rejects anything that drops protected spans or numbers, isn't actually
   * shorter, looks unrelated to the original, or collapsed to almost nothing.
   */
  function verifyRewrite(original, candidate, opts) {
    opts = opts || {};
    var cand = (candidate || "").trim();
    if (!cand) return { ok: false, reason: "empty output" };

    // 1) protected spans preserved
    for (var i = 0; i < SPAN_RES.length; i++) {
      var spans = collect(SPAN_RES[i], original);
      var missing = matchesAll(spans, cand);
      if (missing) return { ok: false, reason: "dropped a protected span (code/URL)" };
    }

    // 2) numbers preserved (as a set)
    var origNums = collect(NUM_RE, original);
    var candNums = collect(NUM_RE, cand);
    for (var n = 0; n < origNums.length; n++) {
      if (candNums.indexOf(origNums[n]) === -1) {
        return { ok: false, reason: "dropped or changed a number (" + origNums[n] + ")" };
      }
    }

    // 3) must not be longer than the original
    var oTok = tokens.estimateTokens(original);
    var cTok = tokens.estimateTokens(cand);
    if (cTok > oTok) return { ok: false, reason: "not shorter than original" };

    // 4) must still be about the same thing
    if (text.jaccard(original, cand) < 0.3) {
      return { ok: false, reason: "output looks unrelated to the prompt" };
    }

    // 5) sanity floor: didn't collapse to almost nothing
    var oWords = (original.match(/\S+/g) || []).length;
    var cWords = (cand.match(/\S+/g) || []).length;
    if (oWords >= 6 && cWords < Math.max(2, Math.round(oWords * 0.25))) {
      return { ok: false, reason: "output dropped too much content" };
    }

    return { ok: true, reason: "ok", originalTokens: oTok, candidateTokens: cTok };
  }

  /** Strip preamble/quotes/code-fence wrapping an LLM may add around a rewrite. */
  function cleanRewrite(out) {
    var s = (out || "").trim();
    // remove a leading label like "Rewritten prompt:"
    s = s.replace(/^\s*(rewritten prompt|rewrite|optimized prompt|here'?s the rewrite)\s*[:\-]\s*/i, "");
    // unwrap a single surrounding code fence
    var fence = s.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
    if (fence) s = fence[1].trim();
    // unwrap matching surrounding quotes
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      s = s.slice(1, -1).trim();
    }
    return s;
  }

  /** Best-effort JSON extraction from a chatty model response. */
  function parseJSONLoose(out) {
    if (!out) return null;
    try {
      return JSON.parse(out);
    } catch (_) {}
    var start = out.search(/[\[{]/);
    if (start === -1) return null;
    var openCh = out[start];
    var closeCh = openCh === "{" ? "}" : "]";
    var end = out.lastIndexOf(closeCh);
    if (end <= start) return null;
    try {
      return JSON.parse(out.slice(start, end + 1));
    } catch (_) {
      return null;
    }
  }

  /** Build a rewrite-result object (same shape as the heuristic engine's). */
  function buildRewriteResult(original, rewritten, changeType) {
    var oTok = tokens.estimateTokens(original);
    var rTok = tokens.estimateTokens(rewritten);
    var saved = oTok - rTok;
    return {
      original: original,
      rewritten: rewritten,
      originalTokens: oTok,
      rewrittenTokens: rTok,
      tokensSaved: saved,
      percentSaved: oTok ? Math.round((saved / oTok) * 100) : 0,
      changes: [{ type: changeType || "llm-rewrite", occurrences: 1 }],
      applied: saved > 0,
      constraintsPreserved: true,
      source: "llm",
    };
  }

  var api = {
    verifyRewrite: verifyRewrite,
    cleanRewrite: cleanRewrite,
    parseJSONLoose: parseJSONLoose,
    buildRewriteResult: buildRewriteResult,
  };
  PW.llm = PW.llm || {};
  PW.llm.provider = api;
  if (isNode) module.exports = api;
})();
