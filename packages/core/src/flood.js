/**
 * flood.js — context-flood detection & nudging.
 *
 * Watches a conversation and decides when the thread has degraded enough that
 * the user is better off summarizing or starting fresh. Signals:
 *   - size      : total tokens vs. soft/hard budgets
 *   - length    : number of turns
 *   - redundancy: repeated content across turns
 *   - drift     : how far recent turns have moved from the original goal
 *
 * Emits a recommendation (none | summarize | reset), a human reason, and the
 * durable facts worth carrying into memory on reset (so nothing is lost).
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});
  var tokens = isNode ? require("./tokens.js") : PW.tokens;
  var text = isNode ? require("./text.js") : PW.text;

  var DEFAULTS = {
    softTokenBudget: 6000, // start nudging to summarize
    hardTokenBudget: 14000, // strongly suggest reset
    softTurns: 20,
    hardTurns: 40,
    redundancyThreshold: 0.28,
    driftThreshold: 0.7, // 1 - similarity to goal
  };

  // Lines that look like durable, reusable facts worth keeping in memory.
  var FACT_RE = /\b(always|never|prefer|must|should|my name is|i am|we use|the project|our (stack|repo|api|brand)|use |don'?t use|format|tone|style guide|constraint|requirement|deadline)\b/i;

  function analyze(messages, opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    messages = messages || [];
    var goal = opts.goal || firstUserContent(messages);

    var totalTokens = tokens.estimateTotal(messages);
    var turnCount = messages.length;

    var redundancy = computeRedundancy(messages);
    var drift = computeDrift(messages, goal);

    // Scoring: each signal contributes 0..1, combined into severity.
    var sizeScore = clamp(totalTokens / opts.hardTokenBudget);
    var lenScore = clamp(turnCount / opts.hardTurns);
    var redScore = clamp(redundancy / (opts.redundancyThreshold * 2));
    var driftScore = clamp(drift / 1);

    var severity = 0.4 * sizeScore + 0.2 * lenScore + 0.2 * redScore + 0.2 * driftScore;

    var reasons = [];
    if (totalTokens >= opts.softTokenBudget)
      reasons.push("thread is ~" + totalTokens + " tokens");
    if (turnCount >= opts.softTurns) reasons.push(turnCount + " turns deep");
    if (redundancy >= opts.redundancyThreshold)
      reasons.push("high repetition (" + Math.round(redundancy * 100) + "%)");
    if (drift >= opts.driftThreshold) reasons.push("conversation has drifted from the original goal");

    var recommendation = "none";
    if (totalTokens >= opts.hardTokenBudget || turnCount >= opts.hardTurns || severity >= 0.75) {
      recommendation = "reset";
    } else if (
      totalTokens >= opts.softTokenBudget ||
      turnCount >= opts.softTurns ||
      redundancy >= opts.redundancyThreshold ||
      severity >= 0.45
    ) {
      recommendation = "summarize";
    }

    return {
      recommendation: recommendation,
      severity: round2(severity),
      reasons: reasons,
      signals: {
        totalTokens: totalTokens,
        turnCount: turnCount,
        redundancy: round2(redundancy),
        drift: round2(drift),
      },
      message: nudgeMessage(recommendation, reasons),
      carryToMemory: recommendation === "none" ? [] : extractFacts(messages),
    };
  }

  function firstUserContent(messages) {
    for (var i = 0; i < messages.length; i++) {
      if ((messages[i].role || "user") === "user") return messages[i].content || "";
    }
    return messages.length ? messages[0].content || "" : "";
  }

  function computeRedundancy(messages) {
    var sents = [];
    messages.forEach(function (m) {
      text.splitSentences(m.content || "").forEach(function (s) {
        if (s.replace(/\s/g, "").length > 12) sents.push(s);
      });
    });
    if (sents.length < 2) return 0;
    var dupes = 0;
    var seen = [];
    sents.forEach(function (s) {
      if (seen.length && text.maxSimilarity(s, seen) >= 0.8) dupes++;
      else seen.push(s);
    });
    return dupes / sents.length;
  }

  function computeDrift(messages, goal) {
    if (!goal) return 0;
    var userMsgs = messages.filter(function (m) { return (m.role || "user") === "user"; });
    if (userMsgs.length < 2) return 0;
    var recent = userMsgs.slice(-2).map(function (m) { return m.content || ""; }).join(" ");
    var sim = text.jaccard(goal, recent);
    return clamp(1 - sim);
  }

  function extractFacts(messages) {
    var facts = [];
    var seen = [];
    messages.forEach(function (m) {
      if ((m.role || "user") !== "user") return;
      text.splitSentences(m.content || "").forEach(function (s) {
        if (FACT_RE.test(s) && s.length < 240) {
          if (!seen.length || text.maxSimilarity(s, seen) < 0.8) {
            facts.push(s.trim());
            seen.push(s);
          }
        }
      });
    });
    return facts.slice(0, 12);
  }

  function nudgeMessage(rec, reasons) {
    if (rec === "none") return null;
    var why = reasons.length ? " (" + reasons.join("; ") + ")" : "";
    if (rec === "reset")
      return "This thread is getting heavy" + why + ". Starting a fresh chat — carrying key facts into memory — will be faster and cheaper.";
    return "Consider summarizing this thread" + why + " to keep responses sharp and costs down.";
  }

  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function round2(x) { return Math.round(x * 100) / 100; }

  var api = { analyze: analyze, DEFAULTS: DEFAULTS };
  PW.flood = api;
  if (isNode) module.exports = api;
})();
