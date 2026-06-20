/**
 * text.js — shared text utilities: normalization, sentence splitting, and
 * similarity. Used by the rewrite engine, flood detector, memory and persona
 * modules. Zero dependencies; runs in Node and the browser.
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});

  var STOP = new Set(
    ("a,an,the,and,or,but,if,then,of,to,in,on,for,with,at,by,from,as,is,are," +
      "was,were,be,been,being,it,this,that,these,those,i,you,we,they,he,she," +
      "do,does,did,can,could,would,should,will,please,my,your,our").split(",")
  );

  function normalize(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenizeWords(s, dropStop) {
    var words = normalize(s).split(" ").filter(Boolean);
    if (dropStop) words = words.filter(function (w) { return !STOP.has(w); });
    return words;
  }

  /** Split text into sentence-ish units, respecting newlines and list items. */
  function splitSentences(text) {
    if (!text) return [];
    var byLine = text.split(/\n+/);
    var out = [];
    byLine.forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      // split a line into sentences on terminal punctuation
      var parts = t.split(/(?<=[.!?])\s+/);
      parts.forEach(function (p) {
        var s = p.trim();
        if (s) out.push(s);
      });
    });
    return out;
  }

  /** Jaccard similarity over content-word sets (0..1). */
  function jaccard(a, b) {
    var sa = new Set(tokenizeWords(a, true));
    var sb = new Set(tokenizeWords(b, true));
    if (sa.size === 0 && sb.size === 0) return 1;
    if (sa.size === 0 || sb.size === 0) return 0;
    var inter = 0;
    sa.forEach(function (w) { if (sb.has(w)) inter++; });
    var union = sa.size + sb.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  /** Best similarity of `sentence` against any string in `pool`. */
  function maxSimilarity(sentence, pool) {
    var best = 0;
    for (var i = 0; i < pool.length; i++) {
      var s = jaccard(sentence, pool[i]);
      if (s > best) best = s;
      if (best === 1) break;
    }
    return best;
  }

  var api = {
    normalize: normalize,
    tokenizeWords: tokenizeWords,
    splitSentences: splitSentences,
    jaccard: jaccard,
    maxSimilarity: maxSimilarity,
    STOP: STOP,
  };
  PW.text = api;
  if (isNode) module.exports = api;
})();
