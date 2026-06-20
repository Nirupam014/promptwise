"use strict";
const test = require("node:test");
const assert = require("node:assert");
const PW = require("../src/index.js");
const { PromptWise, assessModel } = PW;
const modelfit = require("../src/modelfit.js");

test("flags an expensive model on a simple task", () => {
  const a = assessModel("gpt-4o", "what is the capital of France?");
  assert.strictEqual(a.known, true);
  assert.strictEqual(a.tier, 3);
  assert.strictEqual(a.complexityLabel, "simple");
  assert.strictEqual(a.overkill, true);
  assert.match(a.suggestion, /mini/i);
  assert.match(a.message, /overkill/i);
});

test("does NOT flag an expensive model on a complex task", () => {
  const a = assessModel(
    "claude-opus-4",
    "Design a fault-tolerant distributed queue: discuss the architecture, trade-offs, and step by step how you'd implement back-pressure and debug a deadlock."
  );
  assert.strictEqual(a.tier, 3);
  assert.strictEqual(a.complexityLabel, "complex");
  assert.strictEqual(a.overkill, false);
  assert.strictEqual(a.suggestion, null);
});

test("opus on a simple task suggests Haiku", () => {
  const a = assessModel("claude-3-opus", "translate 'good morning' to French");
  assert.strictEqual(a.overkill, true);
  assert.match(a.suggestion, /haiku/i);
});

test("a cheap model is never flagged", () => {
  const a = assessModel("gpt-4o-mini", "what is 2+2?");
  assert.strictEqual(a.tier, 1);
  assert.strictEqual(a.overkill, false);
});

test("unknown model => known:false, no nudge", () => {
  const a = assessModel("some-random-model-x", "hello");
  assert.strictEqual(a.known, false);
  assert.strictEqual(a.overkill, false);
});

test("gemini pro on a trivial task suggests flash", () => {
  const a = assessModel("gemini-2.5-pro", "define photosynthesis");
  assert.strictEqual(a.overkill, true);
  assert.match(a.suggestion, /flash/i);
});

test("complexity heuristic ranks code/architecture above one-liners", () => {
  const simple = modelfit.taskComplexity("rename this variable");
  const complex = modelfit.taskComplexity("Refactor the auth module architecture and optimize the algorithm; ```js\nfunction x(){}\n```");
  assert.ok(complex > simple);
  assert.ok(simple < 0.34);
});

test("engine.optimize includes modelFit when signals.model is given", () => {
  const pw = new PromptWise();
  const out = pw.optimize({ prompt: "what is the capital of France?", signals: { model: "gpt-4o" } });
  assert.ok(out.modelFit);
  assert.strictEqual(out.modelFit.overkill, true);
  // and absent when no model provided
  const out2 = pw.optimize({ prompt: "what is the capital of France?" });
  assert.strictEqual(out2.modelFit, null);
});
