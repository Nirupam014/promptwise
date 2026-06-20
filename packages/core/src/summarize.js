/**
 * summarize.js — pure-JS extractive summarization (no model, no network).
 *
 * Frequency/centroid sentence ranking (a TextRank cousin): score each sentence
 * by how many high-frequency content words it carries, normalized for length,
 * then return the top sentences in their original order, de-duplicated. Used as
 * the heuristic fallback for thread summaries when no LLM is configured — so
 * "Summarize & save" produces something useful everywhere, instantly.
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});
  var text = isNode ? require("./text.js") : PW.text;

  function toTexts(input) {
    if (!input) return [];
    if (typeof input === "string") return [input];
    return input
      .map(function (m) { return typeof m === "string" ? m : m && m.content ? m.content : ""; })
      .filter(Boolean);
  }

  function extractiveSummary(input, opts) {
    opts = opts || {};
    var maxS = opts.maxSentences || 4;
    var minLen = opts.minChars || 24;

    var joined = toTexts(input).join("\n");
    var sentences = text.splitSentences(joined).filter(function (s) {
      return s.replace(/\s/g, "").length >= minLen;
    });
    if (sentences.length === 0) return "";
    if (sentences.length <= maxS) return sentences.join(" ");

    // term frequencies across the thread (content words only)
    var freq = {};
    var maxFreq = 1;
    sentences.forEach(function (s) {
      text.tokenizeWords(s, true).forEach(function (w) {
        freq[w] = (freq[w] || 0) + 1;
        if (freq[w] > maxFreq) maxFreq = freq[w];
      });
    });

    var scored = sentences.map(function (s, i) {
      var words = text.tokenizeWords(s, true);
      if (!words.length) return { i: i, s: s, score: 0 };
      var sum = 0;
      words.forEach(function (w) { sum += freq[w] / maxFreq; });
      // length-normalized so long sentences don't dominate
      return { i: i, s: s, score: sum / Math.sqrt(words.length) };
    });

    scored.sort(function (a, b) { return b.score - a.score; });

    var picked = [];
    for (var k = 0; k < scored.length && picked.length < maxS; k++) {
      var cand = scored[k];
      var dupe = picked.some(function (p) { return text.jaccard(p.s, cand.s) > 0.6; });
      if (!dupe) picked.push(cand);
    }
    picked.sort(function (a, b) { return a.i - b.i; });
    return picked.map(function (p) { return p.s; }).join(" ");
  }

  var api = { extractiveSummary: extractiveSummary };
  PW.summarize = api;
  if (isNode) module.exports = api;
})();
