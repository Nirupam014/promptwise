#!/usr/bin/env node
"use strict";
/**
 * PromptWise MCP server — a connector for Claude desktop (and any MCP client).
 *
 * Implements the Model Context Protocol over stdio (newline-delimited JSON-RPC
 * 2.0) by hand — zero dependencies, matching the rest of the repo. It exposes
 * PromptWise as tools Claude can call: optimize a draft, summarize a thread,
 * analyze context health, estimate tokens, and remember/recall durable facts.
 *
 * Memory is the SAME store the CLI uses (~/.promptwise/memory.json), so facts
 * are shared across surfaces.
 *
 * NOTE: an MCP connector cannot shrink your prompt *before* you send it (by the
 * time a tool runs, your message is already in Claude's context). It adds
 * memory + on-demand optimization/summarization tools instead.
 *
 * IMPORTANT: stdout carries the protocol — never write anything but JSON-RPC to
 * it. All logging goes to stderr.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

let PW;
try {
  PW = require("@promptwise-dev/core");
} catch (_) {
  PW = require("../core/src/index.js");
}

const HOME = path.join(os.homedir(), ".promptwise");
const MEM_FILE = path.join(HOME, "memory.json");

function loadMemory() {
  try { return JSON.parse(fs.readFileSync(MEM_FILE, "utf8")); } catch (_) { return []; }
}
function saveMemory(facts) {
  try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(MEM_FILE, JSON.stringify(facts, null, 2)); } catch (_) {}
}
function log() { try { console.error.apply(console, ["[promptwise-mcp]"].concat([].slice.call(arguments))); } catch (_) {} }

function asMessages(input) {
  if (Array.isArray(input)) return input.map(function (m) { return typeof m === "string" ? { role: "user", content: m } : m; });
  if (typeof input === "string") return [{ role: "user", content: input }];
  return [];
}

// ---- tool registry ----
const TOOLS = [
  {
    name: "optimize_prompt",
    description:
      "Rewrite a draft prompt to use fewer tokens while preserving intent. Returns the tighter prompt and the estimated token saving. Use when the user asks to tighten/shorten a prompt.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The draft prompt to optimize." },
        context: { type: "array", items: { type: "string" }, description: "Optional prior conversation lines already known to the model." },
      },
      required: ["prompt"],
    },
    handler: function (args) {
      const pw = new PW.PromptWise({ memory: new PW.Memory(loadMemory()) });
      const out = pw.optimize({ prompt: args.prompt || "", context: args.context || [], signals: { surface: "desktop" } });
      const r = out.rewrite;
      return (
        "Optimized (" + r.originalTokens + " → " + r.rewrittenTokens + " tokens, -" + r.percentSaved + "%):\n\n" +
        r.rewritten +
        (out.usedMemory && out.usedMemory.length ? "\n\n(used " + out.usedMemory.length + " memory fact(s) to dedupe)" : "")
      );
    },
  },
  {
    name: "summarize_conversation",
    description: "Summarize a conversation or block of text into a concise summary plus durable facts worth remembering.",
    inputSchema: {
      type: "object",
      properties: {
        messages: { description: "Array of {role, content} turns, or a single string of text." },
      },
      required: ["messages"],
    },
    handler: async function (args) {
      const pw = new PW.PromptWise({ memory: new PW.Memory(loadMemory()) });
      const res = await pw.summarizeThread(asMessages(args.messages));
      let out = "Summary:\n" + (res.summary || "(none)");
      if (res.facts && res.facts.length) out += "\n\nDurable facts:\n" + res.facts.map(function (f) { return "- " + f; }).join("\n");
      return out;
    },
  },
  {
    name: "analyze_context",
    description: "Assess whether a conversation has grown too long/repetitive/off-topic, and whether to summarize or start fresh.",
    inputSchema: {
      type: "object",
      properties: { messages: { description: "Array of {role, content} turns, or a string." } },
      required: ["messages"],
    },
    handler: function (args) {
      const res = PW.analyzeFlood(asMessages(args.messages));
      return (
        "Recommendation: " + res.recommendation.toUpperCase() +
        "\nSignals: " + res.signals.totalTokens + " tokens, " + res.signals.turnCount + " turns, " +
        Math.round(res.signals.redundancy * 100) + "% repetition, drift " + res.signals.drift +
        (res.message ? "\n\n" + res.message : "")
      );
    },
  },
  {
    name: "estimate_tokens",
    description: "Estimate the number of tokens in a piece of text.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    handler: function (args) { return "~" + PW.estimateTokens(args.text || "") + " tokens"; },
  },
  {
    name: "check_model_fit",
    description:
      "Check whether a model is overkill (too expensive) for a task. Given the model id and the prompt, returns whether a cheaper model would do and which one.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "The model id, e.g. gpt-4o, claude-opus-4, gemini-2.5-pro." },
        prompt: { type: "string", description: "The task/prompt to size against the model." },
      },
      required: ["model", "prompt"],
    },
    handler: function (args) {
      const a = PW.assessModel(args.model || "", args.prompt || "");
      if (!a.known) return "Model '" + args.model + "' isn't in the registry; can't assess cost fit.";
      return (
        "Task looks " + a.complexityLabel + " (complexity " + a.complexity + "); " +
        a.model + " is tier " + a.tier + "/3.\n" +
        (a.overkill ? "⚠ " + a.message : "Model choice looks reasonable for this task.")
      );
    },
  },
  {
    name: "remember",
    description: "Save a durable fact to PromptWise memory (shared with the CLI). Use for preferences, stack, names, recurring context.",
    inputSchema: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] },
    handler: function (args) {
      const mem = new PW.Memory(loadMemory());
      const f = mem.add(args.fact || "");
      saveMemory(mem.toJSON());
      return f ? "Remembered: " + f.text : "Nothing to remember.";
    },
  },
  {
    name: "recall",
    description: "List remembered facts, optionally filtered by relevance to a query.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Optional topic to filter by." } } },
    handler: function (args) {
      const mem = new PW.Memory(loadMemory());
      const facts = args && args.query ? mem.findRelevant(args.query) : mem.list();
      if (!facts.length) return "Memory is empty.";
      return facts.map(function (f) { return "- " + f.text + "  [" + f.id + "]"; }).join("\n");
    },
  },
  {
    name: "forget",
    description: "Remove a fact from memory by its id (see recall for ids).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    handler: function (args) {
      const mem = new PW.Memory(loadMemory());
      const ok = mem.remove(args.id);
      saveMemory(mem.toJSON());
      return ok ? "Forgot " + args.id : "No fact with id " + args.id;
    },
  },
];

const TOOL_BY_NAME = {};
TOOLS.forEach(function (t) { TOOL_BY_NAME[t.name] = t; });

// ---- JSON-RPC / MCP plumbing ----
const SERVER_INFO = { name: "promptwise", version: "1.0.0" };
let negotiatedVersion = "2025-06-18";

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function result(id, res) { send({ jsonrpc: "2.0", id: id, result: res }); }
function error(id, code, message) { send({ jsonrpc: "2.0", id: id, error: { code: code, message: message } }); }

async function handleRequest(msg) {
  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};

  if (method === "initialize") {
    if (params.protocolVersion) negotiatedVersion = params.protocolVersion;
    return result(id, {
      protocolVersion: negotiatedVersion,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }
  if (method === "ping") return result(id, {});
  if (method === "tools/list") {
    return result(id, {
      tools: TOOLS.map(function (t) { return { name: t.name, description: t.description, inputSchema: t.inputSchema }; }),
    });
  }
  if (method === "tools/call") {
    const tool = TOOL_BY_NAME[(params.name || "")];
    if (!tool) return error(id, -32602, "Unknown tool: " + params.name);
    try {
      const text = await tool.handler(params.arguments || {});
      return result(id, { content: [{ type: "text", text: String(text) }] });
    } catch (e) {
      return result(id, { content: [{ type: "text", text: "Error: " + ((e && e.message) || e) }], isError: true });
    }
  }
  if (id !== undefined) return error(id, -32601, "Method not found: " + method);
  // notification (no id) — nothing to return
}

// ---- stdin loop (newline-delimited JSON-RPC) ----
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", function (chunk) {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { log("bad JSON:", line); continue; }
    Promise.resolve(handleRequest(msg)).catch(function (e) { log("handler error:", e && e.message); });
  }
});
process.stdin.on("end", function () { process.exit(0); });
log("PromptWise MCP server ready (" + TOOLS.length + " tools)");
