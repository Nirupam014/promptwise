"use strict";
const test = require("node:test");
const assert = require("node:assert");
const PW = require("../src/index.js");
const { PromptWise, verifyRewrite, createOllamaProvider, createWebLLMProvider } = PW;

// A fake provider: `responder({system, prompt, json})` returns the model output.
function fakeProvider(responder) {
  return {
    info: () => ({ backend: "fake", model: "test" }),
    available: async () => true,
    complete: async (req) => responder(req),
  };
}

test("verifyRewrite accepts a shorter, faithful rewrite", () => {
  const v = verifyRewrite(
    "Could you please kindly help me to fix the login bug in order to ship.",
    "Fix the login bug to ship."
  );
  assert.strictEqual(v.ok, true);
});

test("verifyRewrite rejects a dropped code block", () => {
  const orig = "Explain this please: ```js\nconst x = foo(1,2,3)\n```";
  const v = verifyRewrite(orig, "Explain this.");
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /protected span/);
});

test("verifyRewrite rejects a dropped/changed number", () => {
  const v = verifyRewrite("Return exactly 7 results from the API.", "Return results from the API.");
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /number/);
});

test("verifyRewrite rejects an unrelated output", () => {
  const v = verifyRewrite("Write a haiku about the ocean and waves.", "The capital of France is Paris.");
  assert.strictEqual(v.ok, false);
});

test("verifyRewrite rejects a longer output", () => {
  const v = verifyRewrite("Fix bug.", "Could you please very kindly help me to fix this small bug now thanks.");
  assert.strictEqual(v.ok, false);
});

test("optimizeWithLLM uses the LLM when it returns a valid shorter rewrite", async () => {
  const provider = fakeProvider(() => "Fix the login bug to ship.");
  const pw = new PromptWise({ provider });
  const out = await pw.optimizeWithLLM({
    prompt: "Could you please kindly help me to fix the login bug in order to ship. Thanks so much!",
  });
  assert.strictEqual(out.mode, "llm");
  assert.strictEqual(out.llm.used, true);
  assert.strictEqual(out.rewrite.source, "llm");
  assert.ok(out.rewrite.tokensSaved > 0);
});

test("optimizeWithLLM falls back to heuristic when the LLM drops a number", async () => {
  const provider = fakeProvider(() => "Return results from the API."); // drops the 7
  const pw = new PromptWise({ provider });
  const out = await pw.optimizeWithLLM({ prompt: "Please return exactly 7 results from the API endpoint." });
  assert.strictEqual(out.mode, "heuristic");
  assert.strictEqual(out.llm.rejected, true);
  assert.match(out.llm.reason, /number/);
});

test("optimizeWithLLM falls back gracefully when the provider throws", async () => {
  const provider = fakeProvider(() => { throw new Error("connection refused"); });
  const pw = new PromptWise({ provider });
  const out = await pw.optimizeWithLLM({ prompt: "Could you please just simplify this for me, thanks." });
  assert.strictEqual(out.mode, "heuristic");
  assert.strictEqual(out.llm.used, false);
  assert.match(out.llm.error, /connection refused/);
});

test("optimizeWithLLM with no provider returns heuristic result", async () => {
  const pw = new PromptWise();
  const out = await pw.optimizeWithLLM({ prompt: "Kindly please just fix this now." });
  assert.strictEqual(out.mode, "heuristic");
  assert.strictEqual(out.llm.used, false);
  assert.ok(out.rewrite); // still optimized heuristically
});

test("optimizeWithLLMStream streams tokens and finalizes a verified rewrite", async () => {
  const chunks = ["Fix ", "the ", "login ", "bug."];
  const provider = {
    info: () => ({ backend: "fake" }),
    available: async () => true,
    complete: async () => chunks.join(""),
    completeStream: async (req, onToken) => {
      let full = "";
      for (const c of chunks) { full += c; onToken && onToken(c, full); }
      return full;
    },
  };
  const pw = new PromptWise({ provider });
  const seen = [];
  const out = await pw.optimizeWithLLMStream(
    { prompt: "Could you please kindly help me to fix the login bug in order to ship. Thanks!" },
    (t) => seen.push(t)
  );
  assert.deepStrictEqual(seen, chunks, "tokens streamed to callback");
  assert.strictEqual(out.mode, "llm");
  assert.strictEqual(out.rewrite.rewritten, "Fix the login bug.");
});

test("optimizeWithLLMStream falls back when provider can't stream", async () => {
  const provider = { info: () => ({}), available: async () => true, complete: async () => "Fix the bug." };
  const pw = new PromptWise({ provider });
  const out = await pw.optimizeWithLLMStream({ prompt: "Please just fix the bug now, thanks." });
  assert.ok(out.mode === "llm" || out.mode === "heuristic");
});

test("summarizeThread parses LLM JSON into summary + facts", async () => {
  const provider = fakeProvider(() =>
    JSON.stringify({ summary: "Building a Rust CLI named datapipe.", facts: ["Project: datapipe (Rust CLI)", "Must support Windows"] })
  );
  const pw = new PromptWise({ provider });
  const res = await pw.summarizeThread([{ role: "user", content: "Help with my Rust CLI datapipe, must support Windows." }]);
  assert.strictEqual(res.mode, "llm");
  assert.ok(/datapipe/.test(res.summary));
  assert.strictEqual(res.facts.length, 2);
});

test("summarizeThread falls back to heuristic facts on bad JSON", async () => {
  const provider = fakeProvider(() => "not json at all");
  const pw = new PromptWise({ provider });
  const msgs = [{ role: "user", content: "We use pnpm and TypeScript. My name is Sam." }];
  const res = await pw.summarizeThread(msgs);
  assert.strictEqual(res.mode, "heuristic");
  assert.ok(Array.isArray(res.facts));
});

test("curateMemory merges/supersedes via the LLM", async () => {
  const provider = fakeProvider(() =>
    JSON.stringify({ facts: ["We use bun (was pnpm)", "Language: TypeScript"], removed: ["We use pnpm"] })
  );
  const pw = new PromptWise({ provider });
  pw.memory.add("We use pnpm");
  pw.memory.add("Language: TypeScript");
  const res = await pw.curateMemory(["We switched to bun"]);
  assert.strictEqual(res.mode, "llm");
  const texts = pw.memory.list().map((f) => f.text);
  assert.ok(texts.some((t) => /bun/.test(t)));
  assert.ok(!texts.some((t) => t === "We use pnpm"));
});

test("curateMemory falls back to plain add without a provider", async () => {
  const pw = new PromptWise();
  const res = await pw.curateMemory(["We use Vitest for tests"]);
  assert.strictEqual(res.mode, "heuristic");
  assert.ok(pw.memory.list().some((f) => /Vitest/.test(f.text)));
});

test("ollama adapter builds correct request and parses response", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/api/tags")) return { ok: true, json: async () => ({ models: [{ name: "llama3.2:3b" }] }) };
    return { ok: true, json: async () => ({ response: "Fix the bug." }) };
  };
  const p = createOllamaProvider({ model: "llama3.2:3b", fetchImpl: fakeFetch });
  assert.strictEqual((await p.available()), true);
  assert.strictEqual((await p.hasModel()), true);
  const out = await p.complete({ system: "sys", prompt: "long verbose prompt", json: false });
  assert.strictEqual(out, "Fix the bug.");
  const gen = calls.find((c) => c.url.endsWith("/api/generate"));
  const body = JSON.parse(gen.init.body);
  assert.strictEqual(body.model, "llama3.2:3b");
  assert.strictEqual(body.stream, false);
});

test("chromeai adapter uses the global LanguageModel (Gemini Nano)", async () => {
  const prevLM = global.LanguageModel;
  let created = null;
  global.LanguageModel = {
    availability: async () => "available",
    create: async (opts) => {
      created = opts;
      return { prompt: async (p) => "ANSWER: " + p.slice(0, 10), destroy() {} };
    },
  };
  try {
    const { createChromeAIProvider } = require("../src/index.js");
    const p = createChromeAIProvider();
    assert.strictEqual(await p.available(), true);
    const out = await p.complete({ system: "be terse", prompt: "summarize this thread please" });
    assert.ok(/ANSWER:/.test(out));
    assert.deepStrictEqual(created.initialPrompts, [{ role: "system", content: "be terse" }]);
  } finally {
    global.LanguageModel = prevLM;
  }
});

test("chromeai adapter reports unavailable when the API is absent", async () => {
  const prevLM = global.LanguageModel;
  delete global.LanguageModel;
  try {
    const { createChromeAIProvider } = require("../src/index.js");
    const p = createChromeAIProvider();
    assert.strictEqual(await p.available(), false);
  } finally {
    if (prevLM) global.LanguageModel = prevLM;
  }
});

// Build a fake fetch Response whose body streams the given NDJSON lines.
function streamingResponse(lines) {
  let i = 0;
  const enc = new TextEncoder();
  return {
    ok: true,
    body: {
      getReader() {
        return {
          read() {
            if (i < lines.length) {
              const chunk = enc.encode(lines[i++] + "\n");
              return Promise.resolve({ done: false, value: chunk });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    },
  };
}

test("ollama listModels parses /api/tags", async () => {
  const p = createOllamaProvider({
    fetchImpl: async () => ({ ok: true, json: async () => ({ models: [{ name: "llama3.2:3b" }, { name: "qwen2.5:1.5b" }] }) }),
  });
  const models = await p.listModels();
  assert.deepStrictEqual(models, ["llama3.2:3b", "qwen2.5:1.5b"]);
});

test("ollama completeStream accumulates tokens (streaming body)", async () => {
  const p = createOllamaProvider({
    fetchImpl: async () =>
      streamingResponse([
        JSON.stringify({ response: "Fix " }),
        JSON.stringify({ response: "the " }),
        JSON.stringify({ response: "bug.", done: false }),
        JSON.stringify({ done: true }),
      ]),
  });
  const tokens = [];
  const full = await p.completeStream({ prompt: "x" }, (t) => tokens.push(t));
  assert.strictEqual(full, "Fix the bug.");
  assert.deepStrictEqual(tokens, ["Fix ", "the ", "bug."]);
});

test("ollama completeStream works without a streaming body (text fallback)", async () => {
  const ndjson =
    JSON.stringify({ response: "Hello " }) + "\n" + JSON.stringify({ response: "world", done: true });
  const p = createOllamaProvider({
    fetchImpl: async () => ({ ok: true, text: async () => ndjson }),
  });
  const full = await p.completeStream({ prompt: "x" });
  assert.strictEqual(full, "Hello world");
});

test("ollama pull streams progress objects", async () => {
  const p = createOllamaProvider({
    fetchImpl: async () =>
      streamingResponse([
        JSON.stringify({ status: "pulling manifest" }),
        JSON.stringify({ status: "downloading", completed: 50, total: 100 }),
        JSON.stringify({ status: "success" }),
      ]),
  });
  const updates = [];
  await p.pull("llama3.2:3b", (o) => updates.push(o.status));
  assert.deepStrictEqual(updates, ["pulling manifest", "downloading", "success"]);
});

test("ollama diagnose: down (fetch throws)", async () => {
  const p = createOllamaProvider({ fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  const d = await p.diagnose("llama3.2:3b");
  assert.strictEqual(d.reachable, false);
});

test("ollama diagnose: up but origin blocked (403)", async () => {
  const p = createOllamaProvider({ fetchImpl: async () => ({ status: 403, ok: false }) });
  const d = await p.diagnose("llama3.2:3b");
  assert.deepStrictEqual({ reachable: d.reachable, allowed: d.allowed }, { reachable: true, allowed: false });
});

test("ollama diagnose: up, reachable, model missing vs present", async () => {
  const mk = (names) => createOllamaProvider({
    fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({ models: names.map((n) => ({ name: n })) }) }),
  });
  const missing = await mk(["qwen2.5:1.5b"]).diagnose("llama3.2:3b");
  assert.deepStrictEqual({ reachable: missing.reachable, allowed: missing.allowed, hasModel: missing.hasModel }, { reachable: true, allowed: true, hasModel: false });
  const present = await mk(["llama3.2:3b"]).diagnose("llama3.2:3b");
  assert.strictEqual(present.hasModel, true);
});

test("webllm adapter wraps an injected engine", async () => {
  const engine = {
    chat: { completions: { create: async ({ messages }) => ({ choices: [{ message: { content: "Short." } }] }) } },
  };
  const p = createWebLLMProvider({ engine, model: "Llama-3.2-3B-Instruct" });
  assert.strictEqual(await p.available(), true);
  assert.strictEqual(await p.complete({ prompt: "make it short" }), "Short.");
});
