"use strict";
const test = require("node:test");
const assert = require("node:assert");
const PW = require("../src/index.js");
const { PromptWise, Memory, rewrite, analyzeFlood, detectPersona, estimateTokens } = PW;

test("estimateTokens grows with length and is non-zero", () => {
  assert.ok(estimateTokens("hello world") > 0);
  assert.ok(estimateTokens("a".repeat(400)) > estimateTokens("a".repeat(40)));
  assert.strictEqual(estimateTokens(""), 0);
});

test("rewrite removes filler and shortens", () => {
  const r = rewrite(
    "Could you please kindly help me to write a function. Thank you so much in advance!"
  );
  assert.ok(r.rewrittenTokens < r.originalTokens, "should save tokens");
  assert.ok(r.tokensSaved > 0);
  assert.ok(!/please/i.test(r.rewritten), "filler removed");
  assert.ok(/function/i.test(r.rewritten), "intent kept");
});

test("rewrite simplifies verbose phrases", () => {
  const r = rewrite("In order to proceed, due to the fact that we are late, make use of the cache.");
  assert.ok(/\bto proceed\b/i.test(r.rewritten));
  assert.ok(/because/i.test(r.rewritten));
  assert.ok(/\buse the cache\b/i.test(r.rewritten));
});

test("rewrite preserves code blocks verbatim", () => {
  const code = "```js\nconst x = veryLongName_doNotTouch(1,2,3);\n```";
  const r = rewrite("Please simply explain this code: " + code);
  assert.ok(r.rewritten.includes("veryLongName_doNotTouch(1,2,3)"), "code untouched");
});

test("rewrite preserves URLs and numbers", () => {
  const r = rewrite("Kindly fetch https://api.example.com/v2?id=42 and return exactly 7 results.");
  assert.ok(r.rewritten.includes("https://api.example.com/v2?id=42"));
  assert.ok(r.rewritten.includes("7"));
});

test("rewrite drops context already known", () => {
  const r = rewrite("We are building a Rust CLI. Now add a --verbose flag to the Rust CLI we are building.", {
    context: ["We are building a Rust CLI."],
  });
  // The restated context sentence should be gone, the new instruction kept.
  assert.ok(/--verbose/.test(r.rewritten));
  assert.ok(r.tokensSaved > 0);
});

test("rewrite never returns something longer than original", () => {
  const tiny = "Fix bug.";
  const r = rewrite(tiny);
  assert.ok(r.rewrittenTokens <= r.originalTokens);
});

test("rewrite handles empty input safely", () => {
  const r = rewrite("");
  assert.strictEqual(r.tokensSaved, 0);
  assert.strictEqual(r.applied, false);
});

test("persona detects developer from code", () => {
  const p = detectPersona({ surface: "browser", promptText: "fix this async function that throws an exception" });
  assert.strictEqual(p.persona, "developer");
});

test("persona detects developer from IDE surface", () => {
  const p = detectPersona({ surface: "ide", hostApp: "vscode", promptText: "rename this" });
  assert.strictEqual(p.persona, "developer");
  assert.ok(p.confidence >= 0.8);
});

test("persona detects analyst-writer", () => {
  const p = detectPersona({ surface: "browser", promptText: "summarize this report and draft an email" });
  assert.strictEqual(p.persona, "analyst-writer");
});

test("memory dedup and findRelevant", () => {
  const m = new Memory();
  m.add("We use TypeScript and pnpm.");
  m.add("We use TypeScript and pnpm."); // duplicate
  assert.strictEqual(m.list().length, 1);
  const rel = m.findRelevant("set up a typescript build");
  assert.ok(rel.length >= 1);
});

test("flood: short healthy thread = none", () => {
  const res = analyzeFlood([
    { role: "user", content: "Help me write a haiku about spring." },
    { role: "assistant", content: "Sure, here is one." },
  ]);
  assert.strictEqual(res.recommendation, "none");
});

test("flood: huge thread recommends reset and carries facts", () => {
  const msgs = [{ role: "user", content: "I prefer TypeScript. My name is Sam. We use pnpm." }];
  for (let i = 0; i < 45; i++) {
    msgs.push({ role: "user", content: "Iterate on the homepage layout component number " + i + " ".repeat(20) });
    msgs.push({ role: "assistant", content: "Done with component " + i + ". ".repeat(20) });
  }
  const res = analyzeFlood(msgs);
  assert.strictEqual(res.recommendation, "reset");
  assert.ok(res.carryToMemory.length >= 1, "should extract durable facts");
  assert.ok(res.message && res.message.length > 0);
});

test("engine.optimize end-to-end produces a suggestion", () => {
  const pw = new PromptWise();
  pw.memory.add("The project is a Next.js e-commerce app.");
  const out = pw.optimize({
    prompt:
      "I would like you to please add a checkout button. As you know the project is a Next.js e-commerce app, so just add it to the Next.js e-commerce app.",
    signals: { surface: "ide", hostApp: "vscode" },
  });
  assert.strictEqual(out.persona.persona, "developer");
  assert.ok(out.suggestion, "suggestion present");
  assert.ok(out.rewrite.tokensSaved > 0);
  assert.ok(pw.stats.tokensSaved > 0);
});

test("engine stats accumulate", () => {
  const pw = new PromptWise();
  pw.optimize({ prompt: "Could you please just simplify this." });
  pw.optimize({ prompt: "Kindly basically explain that." });
  assert.strictEqual(pw.stats.promptsOptimized, 2);
});
