/**
 * engine.js — PromptWise façade that ties the modules together.
 *
 * One object the surface adapters (CLI, browser, IDE) talk to. It owns the
 * memory store, runs persona detection + rewrite on a draft prompt, and runs
 * flood analysis over a conversation.
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});
  var rewriteMod = isNode ? require("./rewrite.js") : PW.rewrite;
  var floodMod = isNode ? require("./flood.js") : PW.flood;
  var memoryMod = isNode ? require("./memory.js") : PW.memory;
  var personaMod = isNode ? require("./persona.js") : PW.persona;
  var tokens = isNode ? require("./tokens.js") : PW.tokens;

  function PromptWise(config) {
    config = config || {};
    this.config = config;
    this.memory = config.memory instanceof memoryMod.Memory
      ? config.memory
      : new memoryMod.Memory(config.memory || []);
    this.stats = { promptsOptimized: 0, tokensSaved: 0 };
    this.provider = config.provider || null; // optional LLM provider
    this.outputBudget = config.outputBudget || null; // output-token control
  }

  /** Enable/disable/configure output brevity directives. */
  PromptWise.prototype.setOutputBudget = function (budget) {
    this.outputBudget = budget || null;
    return this;
  };

  /** Attach (or clear) an LLM provider used by the optimize*WithLLM methods. */
  PromptWise.prototype.setProvider = function (provider) {
    this.provider = provider || null;
    return this;
  };

  /**
   * Optimize a single draft prompt.
   * @param {Object} input
   * @param {string} input.prompt        the draft the user is about to send
   * @param {Array}  [input.context]     visible conversation (strings or {role,content})
   * @param {Object} [input.signals]     surface/host/fileTypes/threadLength for persona
   */
  PromptWise.prototype.optimize = function (input) {
    input = input || {};
    var prompt = input.prompt || "";
    var context = input.context || [];
    var signals = Object.assign({ promptText: prompt }, input.signals || {});
    if (!signals.threadLength) signals.threadLength = context.length;

    var persona = personaMod.detect(signals);
    var relevant = this.memory.findRelevant(prompt);
    var rewrite = rewriteMod.rewrite(prompt, {
      context: context,
      memory: relevant,
      persona: persona,
      contextDropThreshold: this.config.contextDropThreshold,
      repeatThreshold: this.config.repeatThreshold,
    });

    this.stats.promptsOptimized++;
    this.stats.tokensSaved += rewrite.tokensSaved;

    // Model-fit check: when the caller tells us which model is selected, flag
    // an expensive model on a simple task.
    var modelFit = null;
    if (signals.model) {
      var mf = isNode ? require("./modelfit.js") : PW.modelfit;
      modelFit = mf.assess({ model: signals.model, prompt: prompt });
    }

    return {
      persona: persona,
      rewrite: rewrite,
      usedMemory: relevant.map(function (f) { return f.text; }),
      suggestion: buildSuggestion(rewrite, persona, this.outputBudget),
      modelFit: modelFit,
    };
  };

  /** Standalone model-fit check (no rewrite). */
  PromptWise.prototype.assessModel = function (model, prompt) {
    var mf = isNode ? require("./modelfit.js") : PW.modelfit;
    return mf.assess({ model: model, prompt: prompt });
  };

  /** Analyze a conversation for context flooding. */
  PromptWise.prototype.analyzeConversation = function (messages, opts) {
    return floodMod.analyze(messages, opts);
  };

  function llmTasks() { return isNode ? require("./llm/tasks.js") : PW.llm.tasks; }
  function llmProvider() { return isNode ? require("./llm/provider.js") : PW.llm.provider; }

  /**
   * Like optimize(), but also runs the LLM (if a provider is set) and uses its
   * rewrite when it passes the guardrails AND beats the heuristic on tokens.
   * Always falls back to the heuristic result; never throws.
   * Returns the optimize() shape plus { mode, llm:{...} }.
   */
  PromptWise.prototype.optimizeWithLLM = function (input) {
    var self = this;
    var base = this.optimize(input); // instant heuristic baseline
    if (!this.provider) {
      return Promise.resolve(Object.assign({}, base, { mode: "heuristic", llm: { used: false } }));
    }
    var prompt = (input && input.prompt) || "";
    var tasks = llmTasks();
    var prov = llmProvider();
    return tasks
      .rewrite(this.provider, prompt, {
        context: (input && input.context) || [],
        memory: self.memory.findRelevant(prompt),
        persona: base.persona,
      })
      .then(function (candidate) {
        var v = prov.verifyRewrite(prompt, candidate);
        if (!v.ok) {
          return Object.assign({}, base, { mode: "heuristic", llm: { used: true, rejected: true, reason: v.reason } });
        }
        var llmRewrite = prov.buildRewriteResult(prompt, candidate, "llm-rewrite");
        // pick whichever is shorter; tie goes to the LLM (better phrasing)
        if (llmRewrite.rewrittenTokens <= base.rewrite.rewrittenTokens) {
          self.stats.tokensSaved += llmRewrite.tokensSaved - base.rewrite.tokensSaved;
          return Object.assign({}, base, {
            rewrite: llmRewrite,
            suggestion: buildSuggestion(llmRewrite, base.persona, self.outputBudget),
            mode: "llm",
            llm: { used: true, rejected: false },
          });
        }
        return Object.assign({}, base, { mode: "heuristic", llm: { used: true, rejected: true, reason: "heuristic was shorter" } });
      })
      .catch(function (err) {
        return Object.assign({}, base, { mode: "heuristic", llm: { used: false, error: String((err && err.message) || err) } });
      });
  };

  /**
   * Streaming variant of optimizeWithLLM. `onToken(chunk, full)` fires as the
   * LLM emits tokens (for live preview). Resolves to the same shape as
   * optimizeWithLLM. Falls back to the non-streaming path when the provider
   * doesn't support streaming.
   */
  PromptWise.prototype.optimizeWithLLMStream = function (input, onToken) {
    var self = this;
    var base = this.optimize(input);
    if (!this.provider || typeof this.provider.completeStream !== "function") {
      return this.optimizeWithLLM(input);
    }
    var prompt = (input && input.prompt) || "";
    var tasks = llmTasks();
    var prov = llmProvider();
    return tasks
      .rewriteStream(this.provider, prompt, {
        context: (input && input.context) || [],
        memory: self.memory.findRelevant(prompt),
        persona: base.persona,
      }, onToken)
      .then(function (candidate) {
        var v = prov.verifyRewrite(prompt, candidate);
        if (!v.ok) {
          return Object.assign({}, base, { mode: "heuristic", llm: { used: true, rejected: true, reason: v.reason } });
        }
        var llmRewrite = prov.buildRewriteResult(prompt, candidate, "llm-rewrite");
        if (llmRewrite.rewrittenTokens <= base.rewrite.rewrittenTokens) {
          return Object.assign({}, base, {
            rewrite: llmRewrite,
            suggestion: buildSuggestion(llmRewrite, base.persona, self.outputBudget),
            mode: "llm",
            llm: { used: true, rejected: false },
          });
        }
        return Object.assign({}, base, { mode: "heuristic", llm: { used: true, rejected: true, reason: "heuristic was shorter" } });
      })
      .catch(function (err) {
        return Object.assign({}, base, { mode: "heuristic", llm: { used: false, error: String((err && err.message) || err) } });
      });
  };

  /**
   * Summarize a conversation into a compact summary + durable facts. Uses the
   * LLM when available; otherwise falls back to the heuristic fact extractor.
   */
  PromptWise.prototype.summarizeThread = function (messages) {
    var heuristic = floodMod.analyze(messages);
    var summarizeMod = isNode ? require("./summarize.js") : PW.summarize;
    function heuristicResult() {
      return {
        summary: summarizeMod.extractiveSummary(messages, { maxSentences: 5 }) || null,
        facts: heuristic.carryToMemory,
        mode: "heuristic",
      };
    }
    if (!this.provider) {
      return Promise.resolve(heuristicResult());
    }
    return llmTasks()
      .summarize(this.provider, messages)
      .then(function (res) {
        if (!res || (!res.summary && (!res.facts || !res.facts.length))) {
          return heuristicResult();
        }
        return { summary: res.summary, facts: res.facts, mode: "llm" };
      })
      .catch(function () {
        return heuristicResult();
      });
  };

  /**
   * Fold candidate facts into memory. With an LLM, it dedupes semantically and
   * supersedes outdated facts; otherwise it just adds them. Mutates this.memory
   * and returns { facts, mode }.
   */
  PromptWise.prototype.curateMemory = function (candidates) {
    var self = this;
    candidates = candidates || [];
    if (!this.provider) {
      candidates.forEach(function (c) { self.memory.add(typeof c === "string" ? c : c.text); });
      return Promise.resolve({ facts: self.memory.list().map(function (f) { return f.text; }), mode: "heuristic" });
    }
    return llmTasks()
      .curateMemory(this.provider, this.memory.list(), candidates)
      .then(function (res) {
        if (res && Array.isArray(res.facts)) {
          self.memory = new memoryMod.Memory(res.facts);
          return { facts: res.facts, removed: res.removed || [], mode: "llm" };
        }
        candidates.forEach(function (c) { self.memory.add(typeof c === "string" ? c : c.text); });
        return { facts: self.memory.list().map(function (f) { return f.text; }), mode: "heuristic" };
      })
      .catch(function () {
        candidates.forEach(function (c) { self.memory.add(typeof c === "string" ? c : c.text); });
        return { facts: self.memory.list().map(function (f) { return f.text; }), mode: "heuristic" };
      });
  };

  /** Convenience: token estimate for any text. */
  PromptWise.prototype.countTokens = function (t) {
    return tokens.estimateTokens(t);
  };

  function brevityMod() { return isNode ? require("./brevity.js") : PW.brevity; }

  function buildSuggestion(rewrite, persona, outputBudget) {
    var directive = outputBudget ? brevityMod().directiveFor(persona, outputBudget) : null;
    var hasCompression = rewrite.applied && rewrite.tokensSaved > 0;
    if (!hasCompression && !directive) return null;

    var rewritten = rewrite.rewritten;
    if (directive) rewritten = rewritten + "\n\n" + directive;

    var reasons = summarizeChanges(rewrite.changes);
    if (directive) reasons.push("added output-brevity directive (caps the answer)");

    return {
      headline: hasCompression
        ? "Save ~" + rewrite.tokensSaved + " tokens (-" + rewrite.percentSaved + "%)" + (directive ? " + shorter answer" : "")
        : "Trim the answer length",
      rewritten: rewritten,
      reasons: reasons,
      outputDirective: directive || null,
    };
  }

  function summarizeChanges(changes) {
    var labels = {
      "remove-filler": "removed filler/politeness",
      "remove-hedge": "removed hedges",
      "simplify-verbose": "tightened verbose phrasing",
      "drop-known-context": "dropped context already known to the model",
      "drop-internal-repeat": "removed repeated sentences",
      "reference-known-block": "referenced re-pasted content instead of repeating it",
      "llm-rewrite": "LLM-compressed",
    };
    return (changes || []).map(function (c) {
      return (labels[c.type] || c.type) + " ×" + (c.occurrences || 1);
    });
  }

  var api = { PromptWise: PromptWise };
  PW.engine = api;
  if (isNode) module.exports = api;
})();
