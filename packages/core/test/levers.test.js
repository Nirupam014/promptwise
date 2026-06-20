"use strict";
const test = require("node:test");
const assert = require("node:assert");
const PW = require("../src/index.js");
const { PromptWise, rewrite } = PW;

test("reference replacement collapses a re-pasted code block already in context", () => {
  const code = "```js\nfunction add(a, b) { return a + b + 1234; }\n```";
  const r = rewrite("Here is the function again: " + code + " Please add error handling.", {
    context: ["Earlier I shared: " + code],
  });
  assert.ok(/the code above/i.test(r.rewritten), "block replaced with a reference");
  assert.ok(!/function add/.test(r.rewritten), "verbatim code not repeated");
  assert.ok(r.rewritten.includes("error handling"), "the new instruction is kept");
  assert.ok(r.tokensSaved > 0);
});

test("reference replacement leaves NON-duplicated code intact", () => {
  const code = "```js\nconst uniqueThing = 42;\n```";
  const r = rewrite("Explain this: " + code, { context: ["totally unrelated context"] });
  assert.ok(r.rewritten.includes("uniqueThing"), "unique code preserved verbatim");
});

test("lower contextDropThreshold trims partially-overlapping sentences", () => {
  const prompt = "We are migrating the billing service to Postgres this quarter. Add a retry to the payment worker.";
  const ctx = ["We are migrating the billing service to Postgres."];
  const strict = rewrite(prompt, { context: ctx, contextDropThreshold: 0.95 });
  const loose = rewrite(prompt, { context: ctx, contextDropThreshold: 0.5 });
  assert.ok(loose.rewrittenTokens <= strict.rewrittenTokens, "looser threshold trims at least as much");
  assert.ok(/retry/.test(loose.rewritten), "the actual instruction survives");
});

test("output budget appends a brevity directive to the suggestion", () => {
  const pw = new PromptWise({ outputBudget: { words: 100, noPreamble: true } });
  const out = pw.optimize({ prompt: "Could you please explain how OAuth refresh tokens work in detail." });
  assert.ok(out.suggestion, "suggestion present");
  assert.ok(out.suggestion.outputDirective, "directive computed");
  assert.ok(/≤100 words/.test(out.suggestion.rewritten), "word cap injected into the prompt");
  assert.ok(/no preamble/i.test(out.suggestion.rewritten));
});

test("output budget produces a suggestion even with nothing to compress", () => {
  const pw = new PromptWise({ outputBudget: true });
  const out = pw.optimize({ prompt: "Explain WebGPU." }); // already tight
  assert.ok(out.suggestion, "still suggests (for output savings)");
  assert.ok(out.suggestion.outputDirective);
});

test("no output budget => no directive (unchanged behavior)", () => {
  const pw = new PromptWise();
  const out = pw.optimize({ prompt: "Could you please kindly help me fix this bug in order to ship." });
  assert.ok(out.suggestion);
  assert.strictEqual(out.suggestion.outputDirective, null);
  assert.ok(!/≤\d+ words/.test(out.suggestion.rewritten));
});

test("stronger heuristic: new filler and verbose patterns trim more", () => {
  const r = rewrite("I'm trying to come up with a plan in order to handle a large number of users, as well as caching.");
  assert.ok(/\bcreate a plan\b/i.test(r.rewritten), "'come up with' -> 'create'");
  assert.ok(/\bto handle\b/i.test(r.rewritten), "'in order to' -> 'to'");
  assert.ok(/\bmany users\b/i.test(r.rewritten), "'a large number of' -> 'many'");
  assert.ok(/\band caching\b/i.test(r.rewritten), "'as well as' -> 'and'");
  assert.ok(r.tokensSaved > 0);
});

test("developer persona brevity directive is code-first", () => {
  const pw = new PromptWise({ outputBudget: true });
  const out = pw.optimize({
    prompt: "Refactor this async function to use Promise.all and explain the change.",
    signals: { surface: "ide", hostApp: "vscode", fileTypes: ["typescript"] },
  });
  assert.strictEqual(out.persona.persona, "developer");
  assert.ok(/code first/i.test(out.suggestion.outputDirective));
});
