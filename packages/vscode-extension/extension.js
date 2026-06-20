"use strict";
/**
 * PromptWise — VS Code / JetBrains-style IDE adapter.
 *
 * Reads the selected prompt (or an input box), runs the local rewrite engine
 * with IDE/developer signals, and offers a one-click apply that replaces the
 * selection. Global memory persists in the extension's globalState.
 *
 * The engine is vendored under ./vendor/core so the extension is self-contained.
 */
const vscode = require("vscode");
const PW = require("./vendor/core/index.js");

const MEM_KEY = "promptwise.memory";
const STATS_KEY = "promptwise.stats";

function getEngine(context) {
  const facts = context.globalState.get(MEM_KEY, []);
  const mem = new PW.Memory(facts);
  const cfg = vscode.workspace.getConfiguration("promptwise");
  const words = cfg.get("outputBudget.maxWords", 0);
  const pw = new PW.PromptWise({
    memory: mem,
    outputBudget: words > 0 ? { words: words, noPreamble: true } : null,
  });
  const provider = buildProvider();
  if (provider) pw.setProvider(provider);
  return pw;
}

/** Build an LLM provider from settings, or null when disabled. */
function buildProvider() {
  const cfg = vscode.workspace.getConfiguration("promptwise");
  if (cfg.get("llm.backend", "off") !== "ollama") return null;
  // Node 18+ has a global fetch; pass it explicitly so the adapter is happy.
  return PW.createOllamaProvider({
    endpoint: cfg.get("llm.endpoint", "http://localhost:11434"),
    model: cfg.get("llm.model", "llama3.2:3b"),
    fetchImpl: typeof fetch !== "undefined" ? fetch : undefined,
  });
}

function fileTypesFor(editor) {
  if (!editor) return [];
  const lang = editor.document.languageId;
  const codey = ["javascript", "typescript", "python", "go", "rust", "java", "c", "cpp", "csharp", "ruby", "php"];
  return codey.indexOf(lang) !== -1 ? [lang] : [];
}

async function optimizeText(context, text, signals) {
  const pw = getEngine(context);
  const result = pw.optimize({ prompt: text, signals });
  // persist cumulative stats
  const stats = context.globalState.get(STATS_KEY, { promptsOptimized: 0, tokensSaved: 0 });
  stats.promptsOptimized += 1;
  stats.tokensSaved += result.rewrite.tokensSaved;
  await context.globalState.update(STATS_KEY, stats);
  return result;
}

function summarize(result) {
  const r = result.rewrite;
  const reasons = result.suggestion ? result.suggestion.reasons.join(", ") : "no change";
  return {
    headline: `PromptWise — ${r.originalTokens} → ${r.rewrittenTokens} tokens (-${r.percentSaved}%, saved ${r.tokensSaved})  ·  persona: ${result.persona.persona}`,
    detail: reasons,
  };
}

function registerOptimizeSelection(context) {
  return vscode.commands.registerCommand("promptwise.optimizeSelection", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return vscode.window.showInformationMessage("PromptWise: open a file and select your prompt first.");
    const sel = editor.selection;
    const text = editor.document.getText(sel.isEmpty ? undefined : sel);
    if (!text.trim()) return vscode.window.showInformationMessage("PromptWise: nothing selected.");

    const minSaving = vscode.workspace.getConfiguration("promptwise").get("minSaving", 3);
    const result = await optimizeText(context, text, {
      surface: "ide",
      hostApp: "vscode",
      fileTypes: fileTypesFor(editor),
    });

    if (!result.suggestion || result.rewrite.tokensSaved < minSaving) {
      return vscode.window.showInformationMessage("PromptWise: prompt is already tight — nothing to trim.");
    }

    const info = summarize(result);
    const pick = await vscode.window.showInformationMessage(
      info.headline,
      { modal: true, detail: info.detail + "\n\n— Rewritten —\n" + result.rewrite.rewritten },
      "Apply",
      "Copy"
    );
    if (pick === "Apply") {
      await editor.edit((b) => b.replace(sel.isEmpty ? fullRange(editor.document) : sel, result.rewrite.rewritten));
      vscode.window.setStatusBarMessage(`PromptWise: saved ~${result.rewrite.tokensSaved} tokens`, 4000);
    } else if (pick === "Copy") {
      await vscode.env.clipboard.writeText(result.rewrite.rewritten);
      vscode.window.setStatusBarMessage("PromptWise: rewritten prompt copied", 3000);
    }
  });
}

function registerOptimizeInput(context) {
  return vscode.commands.registerCommand("promptwise.optimizeInput", async () => {
    const text = await vscode.window.showInputBox({
      prompt: "Paste a prompt to optimize",
      placeHolder: "Could you please help me to ...",
    });
    if (!text) return;
    const result = await optimizeText(context, text, { surface: "ide", hostApp: "vscode" });
    const info = summarize(result);
    const pick = await vscode.window.showInformationMessage(
      info.headline,
      { modal: true, detail: "— Rewritten —\n" + result.rewrite.rewritten },
      "Copy"
    );
    if (pick === "Copy") {
      await vscode.env.clipboard.writeText(result.rewrite.rewritten);
      vscode.window.setStatusBarMessage("PromptWise: copied", 3000);
    }
  });
}

function registerAddMemory(context) {
  return vscode.commands.registerCommand("promptwise.addMemory", async () => {
    const fact = await vscode.window.showInputBox({
      prompt: "Add a durable fact to PromptWise memory",
      placeHolder: "We use TypeScript, pnpm, and Vitest.",
    });
    if (!fact) return;
    const facts = context.globalState.get(MEM_KEY, []);
    facts.push({ text: fact, pinned: false, createdAt: new Date().toISOString() });
    await context.globalState.update(MEM_KEY, facts);
    vscode.window.showInformationMessage("PromptWise: fact added to memory.");
  });
}

function registerDeepOptimize(context) {
  return vscode.commands.registerCommand("promptwise.deepOptimize", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return vscode.window.showInformationMessage("PromptWise: open a file and select your prompt first.");
    const sel = editor.selection;
    const text = editor.document.getText(sel.isEmpty ? undefined : sel);
    if (!text.trim()) return vscode.window.showInformationMessage("PromptWise: nothing selected.");

    if (vscode.workspace.getConfiguration("promptwise").get("llm.backend", "off") !== "ollama") {
      return vscode.window.showWarningMessage(
        "PromptWise: local LLM is off. Set 'promptwise.llm.backend' to 'ollama' and run Ollama locally."
      );
    }

    const pw = getEngine(context);
    const channel = getOutputChannel();
    channel.clear();
    channel.appendLine("PromptWise — streaming rewrite from the local LLM…\n");
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "PromptWise: optimizing with local LLM…" },
      async () => {
        try {
          return await pw.optimizeWithLLMStream(
            { prompt: text, signals: { surface: "ide", hostApp: "vscode", fileTypes: fileTypesFor(editor) } },
            (tok) => channel.append(tok) // live token stream into the Output panel
          );
        } catch (e) {
          return { error: String((e && e.message) || e) };
        }
      }
    );
    channel.appendLine("\n");

    if (result.error) return vscode.window.showErrorMessage("PromptWise: " + result.error);

    // persist stats
    const stats = context.globalState.get(STATS_KEY, { promptsOptimized: 0, tokensSaved: 0 });
    stats.promptsOptimized += 1;
    stats.tokensSaved += result.rewrite.tokensSaved;
    await context.globalState.update(STATS_KEY, stats);

    const modeLabel = result.mode === "llm" ? "LLM" : "heuristic" + (result.llm && result.llm.rejected ? " (LLM rejected: " + result.llm.reason + ")" : "");
    const info = summarize(result);
    const pick = await vscode.window.showInformationMessage(
      info.headline + "  ·  via " + modeLabel,
      { modal: true, detail: "— Rewritten —\n" + result.rewrite.rewritten },
      "Apply",
      "Copy"
    );
    if (pick === "Apply") {
      await editor.edit((b) => b.replace(sel.isEmpty ? fullRange(editor.document) : sel, result.rewrite.rewritten));
      vscode.window.setStatusBarMessage(`PromptWise: saved ~${result.rewrite.tokensSaved} tokens (${modeLabel})`, 4000);
    } else if (pick === "Copy") {
      await vscode.env.clipboard.writeText(result.rewrite.rewritten);
    }
  });
}

function registerCurateMemory(context) {
  return vscode.commands.registerCommand("promptwise.curateMemory", async () => {
    if (vscode.workspace.getConfiguration("promptwise").get("llm.backend", "off") !== "ollama") {
      return vscode.window.showWarningMessage("PromptWise: enable the Ollama backend to curate memory with the LLM.");
    }
    const input = await vscode.window.showInputBox({
      prompt: "New fact(s) to fold into memory (the LLM will dedupe & supersede old ones)",
      placeHolder: "We switched from pnpm to bun.",
    });
    if (!input) return;
    const pw = getEngine(context);
    const res = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "PromptWise: curating memory…" },
      async () => {
        try {
          return await pw.curateMemory([input]);
        } catch (e) {
          return { error: String((e && e.message) || e) };
        }
      }
    );
    if (res.error) return vscode.window.showErrorMessage("PromptWise: " + res.error);
    await context.globalState.update(MEM_KEY, pw.memory.toJSON());
    vscode.window.showInformationMessage(
      "PromptWise: memory now has " + pw.memory.list().length + " fact(s) (" + res.mode + ")."
    );
  });
}

let _channel = null;
function getOutputChannel() {
  if (!_channel) _channel = vscode.window.createOutputChannel("PromptWise");
  _channel.show(true);
  return _channel;
}

function registerSummarize(context) {
  return vscode.commands.registerCommand("promptwise.summarize", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return vscode.window.showInformationMessage("PromptWise: open a file first.");
    const sel = editor.selection;
    const text = editor.document.getText(sel.isEmpty ? undefined : sel);
    if (!text.trim()) return vscode.window.showInformationMessage("PromptWise: nothing to summarize.");

    const pw = getEngine(context);
    const res = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "PromptWise: summarizing…" },
      async () => {
        try {
          return await pw.summarizeThread([{ role: "user", content: text }]);
        } catch (e) {
          return { error: String((e && e.message) || e) };
        }
      }
    );
    if (res.error) return vscode.window.showErrorMessage("PromptWise: " + res.error);

    const channel = getOutputChannel();
    channel.clear();
    channel.appendLine("PromptWise summary (" + res.mode + ")\n");
    channel.appendLine(res.summary || "(no summary)");
    if (res.facts && res.facts.length) {
      channel.appendLine("\nDurable facts:");
      res.facts.forEach((f) => channel.appendLine("  • " + f));
    }
    vscode.window.showInformationMessage("PromptWise: summary ready (" + res.mode + ") — see the PromptWise output panel.");
  });
}

// ---- Copilot Chat integration: @promptwise participant + language-model tools ----
// Guarded so the extension still loads on older VS Code that lacks these APIs.
function registerChatAndTools(context) {
  const disposables = [];

  // Chat participant: @promptwise [/optimize | /summarize | /remember | /recall]
  if (vscode.chat && typeof vscode.chat.createChatParticipant === "function") {
    const handler = async (request, ctx, stream, token) => {
      const pw = getEngine(context);
      const text = (request.prompt || "").trim();
      const command = request.command;

      if (command === "remember") {
        if (!text) { stream.markdown("Give me a fact to remember, e.g. `@promptwise /remember we use pnpm`."); return {}; }
        pw.memory.add(text);
        await context.globalState.update(MEM_KEY, pw.memory.toJSON());
        stream.markdown("Remembered: **" + text + "**");
        return {};
      }
      if (command === "recall") {
        const facts = text ? pw.memory.findRelevant(text) : pw.memory.list();
        stream.markdown(facts.length ? facts.map((f) => "- " + f.text).join("\n") : "_Memory is empty._");
        return {};
      }
      if (command === "summarize") {
        if (!text) { stream.markdown("Paste text after `@promptwise /summarize`."); return {}; }
        const res = await pw.summarizeThread([{ role: "user", content: text }]);
        stream.markdown("**Summary** (" + res.mode + ")\n\n" + (res.summary || "_(none)_"));
        if (res.facts && res.facts.length) stream.markdown("\n\n**Facts:** " + res.facts.join(" · "));
        return {};
      }
      // default + /optimize
      if (!text) { stream.markdown("Type a prompt to optimize, e.g. `@promptwise could you please help me…`"); return {}; }
      const out = pw.provider
        ? await pw.optimizeWithLLM({ prompt: text, signals: { surface: "ide", hostApp: "vscode" } })
        : pw.optimize({ prompt: text, signals: { surface: "ide", hostApp: "vscode" } });
      const r = out.rewrite;
      const finalText = out.suggestion ? out.suggestion.rewritten : r.rewritten;
      stream.markdown(
        "**" + r.originalTokens + " → " + r.rewrittenTokens + " tokens** (−" + r.percentSaved + "%" +
        (out.mode ? ", " + out.mode : "") + ")\n\n```\n" + finalText + "\n```"
      );
      return {};
    };

    try {
      const participant = vscode.chat.createChatParticipant("promptwise.chat", handler);
      disposables.push(participant);
    } catch (e) { /* participant unavailable */ }
  }

  // Language-model tools: Copilot agent mode can call these.
  if (vscode.lm && typeof vscode.lm.registerTool === "function") {
    const textResult = (s) => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(String(s))]);
    const register = (name, fn) => {
      try { disposables.push(vscode.lm.registerTool(name, { invoke: fn })); } catch (e) {}
    };

    register("promptwise_optimize", async (options) => {
      const pw = getEngine(context);
      const out = pw.optimize({ prompt: (options.input && options.input.prompt) || "", signals: { surface: "ide" } });
      const r = out.rewrite;
      return textResult(
        "Optimized (" + r.originalTokens + " → " + r.rewrittenTokens + " tokens, -" + r.percentSaved + "%):\n\n" + r.rewritten
      );
    });
    register("promptwise_summarize", async (options) => {
      const pw = getEngine(context);
      const res = await pw.summarizeThread([{ role: "user", content: (options.input && options.input.text) || "" }]);
      let s = "Summary: " + (res.summary || "(none)");
      if (res.facts && res.facts.length) s += "\nFacts: " + res.facts.join("; ");
      return textResult(s);
    });
    register("promptwise_recall", async (options) => {
      const pw = getEngine(context);
      const q = options.input && options.input.query;
      const facts = q ? pw.memory.findRelevant(q) : pw.memory.list();
      return textResult(facts.length ? facts.map((f) => "- " + f.text).join("\n") : "Memory is empty.");
    });
  }

  disposables.forEach((d) => context.subscriptions.push(d));
}

function makeStatusBar(context) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  function refresh() {
    const cfg = vscode.workspace.getConfiguration("promptwise");
    const backend = cfg.get("llm.backend", "off");
    item.text = backend === "ollama" ? "✦ PromptWise: " + cfg.get("llm.model", "llama3.2:3b") : "✦ PromptWise";
    item.tooltip = backend === "ollama" ? "Local LLM on (Ollama). Deep Optimize: ⌘⌥⇧P" : "Heuristic mode. Enable Ollama in settings for deep optimize.";
    item.command = "promptwise.deepOptimize";
    item.show();
  }
  refresh();
  context.subscriptions.push(
    item,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("promptwise")) refresh();
    })
  );
}

function fullRange(doc) {
  const last = doc.lineAt(doc.lineCount - 1);
  return new vscode.Range(0, 0, doc.lineCount - 1, last.text.length);
}

function activate(context) {
  context.subscriptions.push(
    registerOptimizeSelection(context),
    registerOptimizeInput(context),
    registerAddMemory(context),
    registerDeepOptimize(context),
    registerCurateMemory(context),
    registerSummarize(context)
  );
  registerChatAndTools(context);
  makeStatusBar(context);
}

function deactivate() {}

module.exports = { activate, deactivate };
