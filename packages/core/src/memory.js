/**
 * memory.js — global memory store of durable facts.
 *
 * Holds stable facts (preferences, project context, house style, recurring
 * constraints) that the rewrite engine can dedupe a prompt against, so the
 * user stops re-sending the same context every turn. Pure in-memory; the CLI
 * and extensions persist/serialize it themselves.
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});
  var text = isNode ? require("./text.js") : PW.text;

  function Memory(initial) {
    this.facts = [];
    if (initial && initial.length) {
      var self = this;
      initial.forEach(function (f) {
        if (typeof f === "string") self.add(f);
        else self.facts.push(normalizeFact(f));
      });
    }
  }

  function normalizeFact(f) {
    return {
      id: f.id || "m_" + Math.random().toString(36).slice(2, 10),
      text: (f.text || "").trim(),
      type: f.type || "fact",
      pinned: !!f.pinned,
      createdAt: f.createdAt || new Date().toISOString(),
    };
  }

  Memory.prototype.add = function (factText, opts) {
    opts = opts || {};
    var t = (factText || "").trim();
    if (!t) return null;
    // avoid near-duplicate memories
    for (var i = 0; i < this.facts.length; i++) {
      if (text.jaccard(this.facts[i].text, t) > 0.85) return this.facts[i];
    }
    var fact = normalizeFact({ text: t, type: opts.type, pinned: opts.pinned });
    this.facts.push(fact);
    return fact;
  };

  Memory.prototype.remove = function (id) {
    var n = this.facts.length;
    this.facts = this.facts.filter(function (f) { return f.id !== id; });
    return this.facts.length < n;
  };

  Memory.prototype.list = function () {
    return this.facts.slice();
  };

  /** Facts whose content overlaps the prompt — used to scope dedup. */
  Memory.prototype.findRelevant = function (prompt, threshold) {
    threshold = threshold == null ? 0.12 : threshold;
    var scored = this.facts.map(function (f) {
      return { fact: f, score: text.jaccard(f.text, prompt) };
    });
    return scored
      .filter(function (s) { return s.fact.pinned || s.score >= threshold; })
      .sort(function (a, b) { return b.score - a.score; })
      .map(function (s) { return s.fact; });
  };

  Memory.prototype.toJSON = function () {
    return this.facts.slice();
  };

  var api = { Memory: Memory };
  PW.memory = api;
  if (isNode) module.exports = api;
})();
