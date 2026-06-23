"use strict";
const test = require("node:test");
const assert = require("node:assert");
const PW = require("../src/index.js");
const { PromptWise } = PW;
const summarize = require("../src/summarize.js");

const THREAD = [
  { role: "user", content: "Let's discuss World War 2. What was the historical context leading up to it?" },
  { role: "assistant", content: "World War 2 grew out of unresolved tensions from World War 1, the harsh Treaty of Versailles, and the global Great Depression. Germany faced severe economic hardship and political instability." },
  { role: "user", content: "How did the Treaty of Versailles contribute?" },
  { role: "assistant", content: "The Treaty of Versailles imposed heavy reparations and territorial losses on Germany, fueling resentment that extremist movements exploited. This resentment helped the Nazi party rise to power." },
  { role: "user", content: "And the Great Depression?" },
  { role: "assistant", content: "The Great Depression deepened unemployment and despair in Germany, making radical solutions more appealing to a desperate population." },
];

test("extractiveSummary returns a few representative sentences", () => {
  const s = summarize.extractiveSummary(THREAD, { maxSentences: 3 });
  assert.ok(s.length > 0, "non-empty summary");
  const sentenceCount = s.split(/(?<=[.!?])\s+/).length;
  assert.ok(sentenceCount <= 3, "respects maxSentences");
  // should surface the central topics
  assert.ok(/Versailles|Depression|Germany|World War/i.test(s));
});

test("extractiveSummary returns all when already short", () => {
  const s = summarize.extractiveSummary(["Just one short line about cats and dogs together."], { maxSentences: 4 });
  assert.ok(s.length > 0);
});

test("extractiveSummary handles empty input", () => {
  assert.strictEqual(summarize.extractiveSummary([]), "");
  assert.strictEqual(summarize.extractiveSummary(""), "");
});

// Regression: a thread where one theme is restated many times must not crowd
// out the actual conclusion, and the repeated theme must not be duplicated.
const REDUNDANT_THREAD = [
  { role: "assistant", content: "The platform must focus on prevention, not reporting." },
  { role: "assistant", content: "The platform must focus on prevention, not reporting." },
  { role: "assistant", content: "The platform must focus on prevention, not reporting." },
  { role: "assistant", content: "Token bills spike when context windows explode and expensive models get used unnecessarily." },
  { role: "assistant", content: "Final recommendation: build Agent Reliability Cloud first, with AI Token CFO as a module inside it." },
];

test("dedupes a repeated theme and preserves the closing decision", () => {
  const s = summarize.extractiveSummary(REDUNDANT_THREAD, { maxSentences: 3 });
  assert.ok(/Agent Reliability Cloud/i.test(s), "keeps the final recommendation");
  const repeated = (s.match(/prevention, not reporting/gi) || []).length;
  assert.ok(repeated <= 1, "does not repeat the same theme: got " + repeated);
});

test("surfaces a distinct point instead of filling up on duplicates", () => {
  const s = summarize.extractiveSummary(REDUNDANT_THREAD, { maxSentences: 3 });
  assert.ok(/Token bills/i.test(s), "includes the other distinct point");
});

test("summarizeThread (no LLM) now returns an extractive summary, not null", async () => {
  const pw = new PromptWise();
  const res = await pw.summarizeThread(THREAD);
  assert.strictEqual(res.mode, "heuristic");
  assert.ok(res.summary && res.summary.length > 0, "heuristic summary present (no LLM)");
  assert.ok(Array.isArray(res.facts));
});
