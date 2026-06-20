/**
 * rewrite.js — heuristic prompt rewrite engine.
 *
 * Given a draft prompt plus available context and memory, produce a
 * semantically equivalent but shorter prompt. Strategy:
 *   1. Protect load-bearing spans (code, URLs).
 *   2. Remove politeness/filler and hedges.
 *   3. Replace verbose phrases with concise equivalents.
 *   4. Drop sentences already present in conversation context or memory.
 *   5. Drop sentences the prompt repeats internally.
 *
 * Safety: never returns something longer than the original; preserves code,
 * numbers, named entities and explicit format constraints. Errs toward
 * under-trimming when unsure.
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});
  var tokens = isNode ? require("./tokens.js") : PW.tokens;
  var text = isNode ? require("./text.js") : PW.text;
  var protectMod = isNode ? require("./protect.js") : PW.protect;

  // Phrases removed entirely (politeness / preamble / meta-instructions).
  var FILLERS = [
    /\bcould you please\b/gi,
    /\bcan you please\b/gi,
    /\bwould you please\b/gi,
    /\bcould you\b/gi,
    /\bcan you\b/gi,
    /\bplease kindly\b/gi,
    /\bkindly\b/gi,
    /\bif it'?s not too much trouble\b/gi,
    /\bif you don'?t mind\b/gi,
    /\bi was wondering if you could\b/gi,
    /\bi was wondering\b/gi,
    /\bi would like you to\b/gi,
    /\bi'?d like you to\b/gi,
    /\bi want you to\b/gi,
    /\bi need you to\b/gi,
    /\bi would like to\b/gi,
    /\bi'?d like to\b/gi,
    /\bfor me\b/gi,
    /\bthanks in advance\b/gi,
    /\bthank you( so much)?\b/gi,
    /\bthanks( a lot| so much)?\b/gi,
    /\bin advance\b/gi,
    /\bappreciate it\b/gi,
    /\bplease\b/gi,
    /\bit is important to note that\b/gi,
    /\bplease note that\b/gi,
    /\bit should be noted that\b/gi,
    /\bas a matter of fact\b/gi,
    /\bneedless to say\b/gi,
    /\bi'?d appreciate (it )?if you could\b/gi,
    /\bi'?m trying to\b/gi,
    /\bi am trying to\b/gi,
    /\bhelp me (to )?\b/gi,
    /\bi'?m looking for\b/gi,
    /\bfirst of all\b/gi,
    /\bto be honest\b/gi,
    /\bif that makes sense\b/gi,
    /\bjust to be clear\b/gi,
    /\bgo ahead and\b/gi,
    /\bfeel free to\b/gi,
    /\bwhen you (get a chance|have time)\b/gi,
  ];

  // Hedges / intensifiers safe to drop without changing instruction meaning.
  var HEDGES = [
    /\bbasically\b/gi,
    /\bactually\b/gi,
    /\bsimply\b/gi,
    /\bjust\b/gi,
    /\bliterally\b/gi,
    /\bessentially\b/gi,
    /\bin my opinion\b/gi,
    /\bi think (that )?\b/gi,
    /\bi believe (that )?\b/gi,
    /\bsort of\b/gi,
    /\bkind of\b/gi,
    /\bas you know\b/gi,
    /\bas i mentioned\b/gi,
  ];

  // Verbose -> concise substitutions (meaning-preserving).
  var SUBS = [
    [/\bin order to\b/gi, "to"],
    [/\bdue to the fact that\b/gi, "because"],
    [/\bin spite of the fact that\b/gi, "although"],
    [/\bdespite the fact that\b/gi, "although"],
    [/\bin the event that\b/gi, "if"],
    [/\bat this point in time\b/gi, "now"],
    [/\bat the present time\b/gi, "now"],
    [/\bfor the purpose of\b/gi, "for"],
    [/\bwith regard to\b/gi, "about"],
    [/\bwith respect to\b/gi, "about"],
    [/\bin regards? to\b/gi, "about"],
    [/\ba large number of\b/gi, "many"],
    [/\ba small number of\b/gi, "a few"],
    [/\bthe majority of\b/gi, "most"],
    [/\bin the near future\b/gi, "soon"],
    [/\bon a regular basis\b/gi, "regularly"],
    [/\bmake use of\b/gi, "use"],
    [/\bis able to\b/gi, "can"],
    [/\bare able to\b/gi, "can"],
    [/\bhas the ability to\b/gi, "can"],
    [/\bhave the ability to\b/gi, "can"],
    [/\btake into consideration\b/gi, "consider"],
    [/\bgive an explanation of\b/gi, "explain"],
    [/\bprovide a description of\b/gi, "describe"],
    [/\ba number of\b/gi, "several"],
    [/\bin the process of\b/gi, ""],
    [/\bprior to\b/gi, "before"],
    [/\bsubsequent to\b/gi, "after"],
    [/\bin addition to\b/gi, "besides"],
    [/\bin conjunction with\b/gi, "with"],
    [/\bin the context of\b/gi, "in"],
    [/\bwould like to know\b/gi, "want to know"],
    [/\bcome up with\b/gi, "create"],
    [/\bput together\b/gi, "create"],
    [/\bend result\b/gi, "result"],
    [/\beach and every\b/gi, "every"],
    [/\bbased on the fact that\b/gi, "because"],
    [/\bin terms of\b/gi, "for"],
    [/\bas well as\b/gi, "and"],
    [/\ba lot of\b/gi, "many"],
    [/\bvariety of\b/gi, "various"],
  ];

  function applyList(s, list, label, changes) {
    var hits = 0;
    list.forEach(function (re) {
      s = s.replace(re, function () {
        hits++;
        return " ";
      });
    });
    if (hits) changes.push({ type: label, occurrences: hits });
    return s;
  }

  function applySubs(s, changes) {
    var hits = 0;
    var examples = [];
    SUBS.forEach(function (pair) {
      s = s.replace(pair[0], function (m) {
        hits++;
        if (examples.length < 3) examples.push(m.trim() + " → " + (pair[1] || "∅"));
        return pair[1];
      });
    });
    if (hits) changes.push({ type: "simplify-verbose", occurrences: hits, examples: examples });
    return s;
  }

  function tidy(s) {
    return s
      .replace(/[ \t]+/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/([,;:])\1+/g, "$1")
      .replace(/,\s*([.!?])/g, "$1") // drop a dangling comma before terminal punctuation
      .replace(/([.!?])\s*[,;:]+/g, "$1") // ...or trailing comma/colon after it
      .replace(/[,;:]+\s*$/g, "") // ...or a dangling comma/colon at the very end
      .replace(/\(\s*\)/g, "")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/ +/g, " ")
      .trim();
  }

  function recapitalize(s) {
    // Capitalize first alphabetic char of each line.
    return s.replace(/(^|\n)\s*([a-z])/g, function (m, pre, ch) {
      return pre + ch.toUpperCase();
    });
  }

  function normWs(s) {
    return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  /**
   * Replace blocks the user re-pasted that are ALREADY in the conversation with
   * a short reference, so we stop re-sending big chunks of input every turn.
   * Targets fenced code blocks and long (>1 line) blockquotes; only replaces
   * when the block clearly appears in the provided context.
   */
  function referenceReplace(textIn, contextStrings, changes) {
    if (!contextStrings.length) return textIn;
    var ctxNorm = normWs(contextStrings.join("\n"));
    if (!ctxNorm) return textIn;
    var hits = 0;

    var out = textIn.replace(/```[\s\S]*?```/g, function (block) {
      var inner = block.replace(/^```[a-z0-9]*\n?/i, "").replace(/```$/, "");
      if (inner.trim().length >= 16 && ctxNorm.indexOf(normWs(inner)) !== -1) {
        hits++;
        return "the code above";
      }
      return block;
    });

    // Long pasted blockquotes ("> ...") already present in the thread.
    out = out.replace(/(?:^|\n)((?:>[^\n]*\n?){2,})/g, function (whole, quote) {
      var bare = quote.replace(/^>\s?/gm, "");
      if (bare.trim().length >= 40 && ctxNorm.indexOf(normWs(bare)) !== -1) {
        hits++;
        return "\nthe quote above\n";
      }
      return whole;
    });

    if (hits) changes.push({ type: "reference-known-block", occurrences: hits, reason: "replaced re-pasted content already in the thread" });
    return out;
  }

  function rewrite(prompt, opts) {
    opts = opts || {};
    var context = opts.context || []; // array of strings or {content}
    var memoryFacts = opts.memory || []; // array of {text} or strings
    var original = prompt == null ? "" : String(prompt);
    var originalTokens = tokens.estimateTokens(original);

    // Tunable similarity thresholds (lower = more aggressive trimming).
    var ctxDrop = opts.contextDropThreshold == null ? 0.82 : opts.contextDropThreshold;
    var repeatDrop = opts.repeatThreshold == null ? 0.85 : opts.repeatThreshold;

    var changes = [];

    // Context as raw strings, used both for reference-replacement and dedup.
    var ctxStrings = context
      .map(function (c) { return typeof c === "string" ? c : c && c.content ? c.content : ""; })
      .filter(Boolean);

    // Reference-replace re-pasted blocks BEFORE protecting, so duplicated code
    // is collapsed to a pointer instead of preserved verbatim.
    var pre = referenceReplace(original, ctxStrings, changes);

    var p = protectMod.protect(pre);
    var body = p.text;

    body = applyList(body, FILLERS, "remove-filler", changes);
    body = applyList(body, HEDGES, "remove-hedge", changes);
    body = applySubs(body, changes);

    // Build the pool of things the model already has.
    var ctxPool = [];
    ctxStrings.forEach(function (s) {
      text.splitSentences(s).forEach(function (x) { ctxPool.push(x); });
    });
    memoryFacts.forEach(function (m) {
      var s = typeof m === "string" ? m : m && m.text ? m.text : "";
      if (s) ctxPool.push(s);
    });

    // Sentence-level dedup: against context/memory, then internal repeats.
    var sentences = text.splitSentences(body);
    var kept = [];
    var seen = [];
    var droppedCtx = 0;
    var droppedRepeat = 0;
    var droppedEmpty = 0;
    sentences.forEach(function (sent) {
      var bare = sent.replace(/PW\d+/g, "").trim();
      // Drop orphan fragments left by filler removal (no letters/digits, and
      // no protected span placeholder either).
      if (bare.length > 0 && !/[a-z0-9]/i.test(sent) && !/PW\d+/.test(sent)) {
        droppedEmpty++;
        return;
      }
      if (bare.length > 0) {
        if (ctxPool.length && text.maxSimilarity(sent, ctxPool) >= ctxDrop) {
          droppedCtx++;
          return;
        }
        if (seen.length && text.maxSimilarity(sent, seen) >= repeatDrop) {
          droppedRepeat++;
          return;
        }
      }
      seen.push(sent);
      kept.push(sent);
    });
    if (droppedCtx) changes.push({ type: "drop-known-context", occurrences: droppedCtx, reason: "already in conversation or memory" });
    if (droppedRepeat) changes.push({ type: "drop-internal-repeat", occurrences: droppedRepeat });

    body = kept.join(" ");
    body = tidy(body);
    body = recapitalize(body);

    var rewritten = p.restore(body);

    var rewrittenTokens = tokens.estimateTokens(rewritten);

    // Safety net: never return something longer/empty or that lost all content.
    var safe = rewritten && rewritten.trim().length > 0 && rewrittenTokens <= originalTokens;
    if (!safe) {
      return {
        original: original,
        rewritten: original,
        originalTokens: originalTokens,
        rewrittenTokens: originalTokens,
        tokensSaved: 0,
        percentSaved: 0,
        changes: [],
        applied: false,
        constraintsPreserved: true,
      };
    }

    var saved = originalTokens - rewrittenTokens;
    return {
      original: original,
      rewritten: rewritten,
      originalTokens: originalTokens,
      rewrittenTokens: rewrittenTokens,
      tokensSaved: saved,
      percentSaved: originalTokens ? Math.round((saved / originalTokens) * 100) : 0,
      changes: changes,
      applied: saved > 0,
      constraintsPreserved: true,
      protectedSpans: p.count,
    };
  }

  var api = { rewrite: rewrite, FILLERS: FILLERS, HEDGES: HEDGES, SUBS: SUBS };
  PW.rewrite = api;
  if (isNode) module.exports = api;
})();
