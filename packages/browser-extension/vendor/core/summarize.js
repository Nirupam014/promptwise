/**
 * summarize.js — pure-JS extractive summarization (no model, no network).
 *
 * Ranks each sentence by the high-frequency content words it carries
 * (length-normalized), then selects with three corrections that keep summaries
 * useful instead of repetitive:
 *
 *   1. Position prior — a U-shaped boost so the opening topic sentence and the
 *      closing conclusion/decision are favoured (these are routinely the most
 *      important and the easiest for a pure-frequency ranker to drop).
 *   2. Decision-cue boost — a small bump for sentences that announce a
 *      recommendation/conclusion ("recommend", "instead", "first", etc.).
 *   3. MMR selection — greedy Maximal-Marginal-Relevance: each pick is penalized
 *      by its similarity to what's already chosen, so a theme that repeats many
 *      times can't fill the whole summary. This is the key fix for threads where
 *      one idea is restated over and over and crowds out the actual outcome.
 *
 * Used as the heuristic fallback for thread summaries when no LLM is configured,
 * so "Summarize & save" produces something useful everywhere, instantly.
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});
  var text = isNode ? require("./text.js") : PW.text;

  // Words that tend to introduce a conclusion, decision, or recommendation.
  // Matched against the raw sentence (several are stop-words stripped by the
  // tokenizer, so they'd otherwise never influence the score).
  var DECISION_CUES =
    /\b(recommend|recommended|recommendation|should|must|instead|first|finally|decision|decide|conclusion|conclude|therefore|overall|in summary|to summari[sz]e|key insight|the goal|i'?d|i would|we would|let'?s|build|focus on|the point|in short|bottom line)\b/i;

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
    // How aggressively to penalize redundancy during selection (0..1).
    var diversity = opts.diversity != null ? opts.diversity : 0.5;

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

    var n = sentences.length;
    var scored = sentences.map(function (s, i) {
      var words = text.tokenizeWords(s, true);
      var base = 0;
      if (words.length) {
        var sum = 0;
        words.forEach(function (w) { sum += freq[w] / maxFreq; });
        // length-normalized so long sentences don't dominate
        base = sum / Math.sqrt(words.length);
      }
      // U-shaped position prior: ~1.3x at the very start/end, ~1.0x in the
      // middle. rel in [0,1]; (2*rel-1)^2 is 1 at the ends and 0 at the center.
      var rel = n > 1 ? i / (n - 1) : 0;
      var posWeight = 1 + 0.3 * Math.pow(2 * rel - 1, 2);
      var cueWeight = DECISION_CUES.test(s) ? 1.2 : 1;
      return { i: i, s: s, score: base * posWeight * cueWeight };
    });

    var maxScore = scored.reduce(function (m, x) { return x.score > m ? x.score : m; }, 0) || 1;

    // Greedy MMR: repeatedly take the candidate with the best blend of
    // relevance and dissimilarity to what's already picked; hard-skip
    // near-identical sentences entirely.
    var remaining = scored.slice();
    var picked = [];
    while (picked.length < maxS && remaining.length) {
      var bestPos = -1;
      var bestVal = -Infinity;
      for (var r = 0; r < remaining.length; r++) {
        var cand = remaining[r];
        var sim = 0;
        for (var p = 0; p < picked.length; p++) {
          var sij = text.jaccard(picked[p].s, cand.s);
          if (sij > sim) sim = sij;
        }
        var mmr = (1 - diversity) * (cand.score / maxScore) - diversity * sim;
        if (mmr > bestVal) {
          bestVal = mmr;
          bestPos = r;
        }
      }
      var chosen = remaining.splice(bestPos, 1)[0];
      var dupe = picked.some(function (q) { return text.jaccard(q.s, chosen.s) > 0.7; });
      if (!dupe) picked.push(chosen);
    }

    picked.sort(function (a, b) { return a.i - b.i; });
    return picked.map(function (p) { return p.s; }).join(" ");
  }

  var api = { extractiveSummary: extractiveSummary };
  PW.summarize = api;
  if (isNode) module.exports = api;
})();
