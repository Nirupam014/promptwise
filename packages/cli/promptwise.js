#!/usr/bin/env node
"use strict";
/**
 * PromptWise CLI — optimize prompts, detect context floods, and manage memory
 * from any terminal or coding agent. Zero dependencies.
 *
 * Usage:
 *   promptwise "your prompt here"            optimize a prompt
 *   promptwise optimize -f prompt.txt        optimize a prompt from a file
 *   echo "..." | promptwise                  optimize from stdin
 *   promptwise flood conversation.json       analyze a thread for flooding
 *   promptwise memory add "We use pnpm."     add a durable fact
 *   promptwise memory list                   list memory
 *   promptwise memory rm <id>                remove a fact
 *
 * Flags: --surface <browser|ide|cli|desktop>  --host <app>  --json  --apply
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { execFileSync, spawnSync } = require("child_process");
// Use the published package when installed; fall back to the in-repo source so
// the CLI runs from a clone without an install step.
let PW;
try {
  PW = require("@promptwise-dev/core");
} catch (_) {
  PW = require("../core/src/index.js");
}

const HOME = path.join(os.homedir(), ".promptwise");
const MEM_FILE = path.join(HOME, "memory.json");
const STATS_FILE = path.join(HOME, "stats.json");

// ---------- tiny ANSI helpers (no deps) ----------
const useColor = process.stdout.isTTY;
const c = (code, s) => (useColor ? `[${code}m${s}[0m` : s);
const bold = (s) => c("1", s);
const dim = (s) => c("2", s);
const green = (s) => c("32", s);
const cyan = (s) => c("36", s);
const yellow = (s) => c("33", s);

function loadMemory() {
  try {
    return JSON.parse(fs.readFileSync(MEM_FILE, "utf8"));
  } catch (_) {
    return [];
  }
}
function saveMemory(facts) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(MEM_FILE, JSON.stringify(facts, null, 2));
}
function loadStats() {
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
  } catch (_) {
    return { promptsOptimized: 0, tokensSaved: 0 };
  }
}
function saveStats(stats) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        out.flags[key] = next;
        i++;
      } else out.flags[key] = true;
    } else if (a.startsWith("-f")) {
      out.flags.file = argv[++i];
    } else out._.push(a);
  }
  return out;
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch (_) {
    return "";
  }
}

// Build an Ollama provider from flags/env when --llm is requested.
function buildProvider(args) {
  if (!args.flags.llm) return null;
  return PW.createOllamaProvider({
    endpoint: args.flags["ollama-host"] || process.env.OLLAMA_HOST || "http://localhost:11434",
    model: args.flags.model || process.env.OLLAMA_MODEL || "llama3.2:3b",
  });
}

// Translate --brief / --max-words into an outputBudget.
function outputBudget(args) {
  if (args.flags["max-words"]) return { words: parseInt(args.flags["max-words"], 10) || 120, noPreamble: true };
  if (args.flags.brief) return { words: 120, noPreamble: true };
  return null;
}

async function cmdOptimize(args) {
  let prompt = args._.join(" ");
  if (args.flags.file) prompt = fs.readFileSync(args.flags.file, "utf8");
  if (!prompt && !process.stdin.isTTY) prompt = readStdin();
  prompt = (prompt || "").trim();
  if (!prompt) {
    console.error("No prompt given. Pass a string, use -f <file>, or pipe via stdin.");
    process.exit(1);
  }

  const mem = new PW.Memory(loadMemory());
  const provider = buildProvider(args);
  const pw = new PW.PromptWise({ memory: mem, provider, outputBudget: outputBudget(args) });
  const input = {
    prompt,
    signals: { surface: args.flags.surface || "cli", hostApp: args.flags.host || "", model: args.flags["for-model"] || "" },
  };

  let result;
  if (provider) {
    // Stream the LLM rewrite to stderr so stdout stays clean for piping.
    const useColorErr = process.stderr.isTTY;
    result = await pw.optimizeWithLLMStream(input, (tok) => {
      if (useColorErr) process.stderr.write(dim(tok));
    });
    if (useColorErr) process.stderr.write("\n");
    if (result.llm && result.llm.error) console.error(dim("(LLM unavailable: " + result.llm.error + " — using heuristic)"));
  } else {
    result = pw.optimize(input);
  }

  // persist cumulative savings
  const stats = loadStats();
  stats.promptsOptimized += 1;
  stats.tokensSaved += result.rewrite.tokensSaved;
  saveStats(stats);

  const finalRaw = result.suggestion ? result.suggestion.rewritten : result.rewrite.rewritten;

  // --raw: print ONLY the optimized prompt to stdout, so it composes in shells
  // and wrappers, e.g.  claude "$(promptwise '<prompt>' --raw)"
  if (args.flags.raw) {
    process.stdout.write(finalRaw);
    if (process.stdout.isTTY) process.stdout.write("\n");
    if (result.modelFit && result.modelFit.overkill) process.stderr.write(yellow("⚠ " + result.modelFit.message) + "\n");
    return;
  }

  if (args.flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const r = result.rewrite;
  const finalText = finalRaw;
  console.log(bold("\nPromptWise") + (result.mode ? dim("  (" + result.mode + ")") : ""));
  console.log(
    dim("persona: ") +
      cyan(result.persona.persona) +
      dim(" · task: ") +
      cyan(result.persona.task)
  );
  console.log(
    dim("tokens:  ") +
      r.originalTokens +
      " → " +
      green(String(r.rewrittenTokens)) +
      "  " +
      green("(-" + r.percentSaved + "%, saved " + r.tokensSaved + ")")
  );
  if (result.usedMemory.length)
    console.log(dim("memory:  ") + result.usedMemory.length + " fact(s) used to dedupe");
  if (r.changes.length)
    console.log(dim("changes: ") + (result.suggestion ? result.suggestion.reasons.join(", ") : ""));

  if (result.modelFit && result.modelFit.overkill) {
    console.log(yellow("\n⚠ model: ") + result.modelFit.message);
  }

  console.log(bold("\n— rewritten —"));
  console.log(finalText);
  console.log("");
}

function cmdFlood(args) {
  const file = args._[0] || args.flags.file;
  if (!file) {
    console.error("Usage: promptwise flood <conversation.json>");
    console.error("  JSON: [{\"role\":\"user\",\"content\":\"...\"}, ...]");
    process.exit(1);
  }
  const messages = JSON.parse(fs.readFileSync(file, "utf8"));
  const res = PW.analyzeFlood(messages);
  if (args.flags.json) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  const tag =
    res.recommendation === "reset"
      ? yellow("RESET")
      : res.recommendation === "summarize"
      ? cyan("SUMMARIZE")
      : green("HEALTHY");
  console.log(bold("\nContext health: ") + tag + dim("  (severity " + res.severity + ")"));
  console.log(
    dim("signals: ") +
      res.signals.totalTokens +
      " tokens · " +
      res.signals.turnCount +
      " turns · " +
      Math.round(res.signals.redundancy * 100) +
      "% repetition · drift " +
      res.signals.drift
  );
  if (res.message) console.log("\n" + res.message);
  if (res.carryToMemory.length) {
    console.log(bold("\nFacts worth keeping in memory:"));
    res.carryToMemory.forEach((f) => console.log("  • " + f));
  }
  console.log("");
}

// ---- clipboard helpers (macOS pbcopy/pbpaste, Linux xclip/xsel, Windows clip) ----
function clipRead() {
  try {
    if (process.platform === "darwin") return execFileSync("pbpaste", { encoding: "utf8" });
    if (process.platform === "win32") return execFileSync("powershell", ["-command", "Get-Clipboard"], { encoding: "utf8" });
    return execFileSync("xclip", ["-selection", "clipboard", "-o"], { encoding: "utf8" });
  } catch (_) { return ""; }
}
function clipWrite(text) {
  try {
    var cmd = process.platform === "darwin" ? "pbcopy" : process.platform === "win32" ? "clip" : "xclip";
    var args = process.platform === "linux" ? ["-selection", "clipboard"] : [];
    spawnSync(cmd, args, { input: text });
    return true;
  } catch (_) { return false; }
}

// ---- Claude Code UserPromptSubmit hook ----
// Reads the hook JSON on stdin and injects relevant memory + a context-flood
// nudge as additional context. Fast and silent when there's nothing to add.
// (It augments context rather than rewriting the prompt — that's what hooks can
// safely do; for raw compression use the `claude -p "$(promptwise … --raw)"`
// wrapper that `promptwise init` sets up.)
function cmdHook() {
  let raw = "";
  try { raw = fs.readFileSync(0, "utf8"); } catch (_) {}
  let data = {};
  try { data = JSON.parse(raw); } catch (_) {}
  const prompt = data.prompt || "";

  const mem = new PW.Memory(loadMemory());
  const relevant = mem.findRelevant(prompt).slice(0, 8).map((f) => f.text);

  let floodNote = "";
  try {
    if (data.transcript_path && fs.existsSync(data.transcript_path)) {
      const msgs = fs
        .readFileSync(data.transcript_path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
        .filter(Boolean)
        .map((o) => ({
          role: o.role || (o.type === "user" ? "user" : "assistant"),
          content: typeof o.content === "string" ? o.content : (o.message && o.message.content && String(o.message.content)) || "",
        }))
        .filter((m) => m.content);
      if (msgs.length) {
        const flood = PW.analyzeFlood(msgs);
        if (flood.recommendation !== "none") {
          floodNote = "PromptWise: this conversation is ~" + flood.signals.totalTokens + " tokens; consider /clear or summarizing to keep responses sharp.";
        }
      }
    }
  } catch (_) {}

  const parts = [];
  if (relevant.length) parts.push("Known facts from PromptWise memory: " + relevant.join("; "));
  if (floodNote) parts.push(floodNote);
  if (!parts.length) process.exit(0);

  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: parts.join("\n") } })
  );
  process.exit(0);
}

// ---- environment detection helpers (for `init`) ----
function onPath(name) {
  try {
    const probe = process.platform === "win32" ? "where" : "command";
    const args = process.platform === "win32" ? [name] : ["-v", name];
    const r = spawnSync(probe, args, { encoding: "utf8", shell: process.platform !== "win32" });
    return r.status === 0 && (r.stdout || "").trim().length > 0;
  } catch (_) { return false; }
}

const KNOWN_AGENTS = [
  { bin: "claude", label: "Claude Code", oneshot: 'claude -p "$OPT"', fn: "ccp" },
  { bin: "aider", label: "Aider", oneshot: 'aider --message "$OPT"', fn: "aidero" },
  { bin: "auggie", label: "Auggie", oneshot: 'auggie "$OPT"', fn: "auggieo" },
  { bin: "cursor-agent", label: "Cursor Agent", oneshot: 'cursor-agent "$OPT"', fn: "curso" },
  { bin: "goose", label: "Goose", oneshot: 'goose run -t "$OPT"', fn: "gooseo" },
];

function detectAgents() { return KNOWN_AGENTS.filter((a) => onPath(a.bin)); }

function rcFileFor(shell) {
  const home = os.homedir();
  if (/fish/.test(shell)) return path.join(home, ".config", "fish", "config.fish");
  if (/bash/.test(shell)) return path.join(home, fs.existsSync(path.join(home, ".bashrc")) ? ".bashrc" : ".bash_profile");
  return path.join(home, ".zshrc"); // default to zsh (macOS)
}

// How to invoke this CLI from generated config: prefer a global `promptwise`,
// else an absolute `node <script>`.
function pwInvocation() {
  if (onPath("promptwise")) return "promptwise";
  return 'node "' + path.resolve(process.argv[1]) + '"';
}

async function ollamaUp(endpoint) {
  try {
    const r = await fetch((endpoint || "http://localhost:11434") + "/api/tags");
    if (!r.ok) return null;
    const d = await r.json();
    return (d.models || []).map((m) => m.name);
  } catch (_) { return null; }
}

// Interactive session: track context + input/output tokens via the clipboard,
// no integration into the AI app required.
function cmdSession(args) {
  const mem = new PW.Memory(loadMemory());
  const provider = buildProvider(args);
  const pw = new PW.PromptWise({ memory: mem, provider, outputBudget: outputBudget(args) });
  const turns = []; // {role, content}
  let sentTokens = 0, origTokens = 0, outTokens = 0, savedTokens = 0;

  console.log(bold("\nPromptWise — session tracker"));
  console.log(dim("Type your message to the AI. It's optimized + copied to your clipboard — paste it into the chat."));
  console.log(dim("After you copy the AI's reply, run /reply to capture it. /help for commands.\n"));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: cyan("you ▸ ") });

  function meter() {
    const total = sentTokens + outTokens;
    console.log(
      dim("\n┌ session ") +
        turns.length + " turns · " +
        dim("in ") + green(String(sentTokens)) + dim(" (saved " + savedTokens + ", orig " + origTokens + ")") +
        dim(" · out ") + green(String(outTokens)) +
        dim(" · total ") + bold(String(total))
    );
    const flood = pw.analyzeConversation(turns);
    if (flood.recommendation !== "none") console.log(yellow("└ " + flood.recommendation.toUpperCase()) + dim(" — " + (flood.reasons.join("; ") || "")));
    else console.log(dim("└ context healthy"));
    console.log("");
  }

  function help() {
    console.log(dim([
      "  <text>      optimize your message, copy it to clipboard",
      "  /reply      capture the AI's reply from your clipboard (logs output tokens)",
      "  /status     show the running token meter + context health",
      "  /summary    summarize the session so far",
      "  /reset      summarize, save facts to memory, clear the thread",
      "  /quit       exit",
    ].join("\n")) + "\n");
  }

  async function handle(line) {
    if (line === "/quit" || line === "/exit") { rl.close(); return; }
    if (line === "/help") { help(); return; }
    if (line === "/status") { meter(); return; }
    if (line === "/summary") {
      const res = await pw.summarizeThread(turns);
      console.log(bold("\nsummary ") + dim("(" + res.mode + ")"));
      console.log(res.summary || dim("(nothing yet)"));
      if (res.facts && res.facts.length) { console.log(dim("facts: ") + res.facts.join(" · ")); }
      console.log("");
      return;
    }
    if (line === "/reset") {
      const res = await pw.summarizeThread(turns);
      (res.facts || []).forEach((f) => pw.memory.add(f));
      saveMemory(pw.memory.toJSON());
      turns.length = 0; sentTokens = outTokens = savedTokens = origTokens = 0;
      console.log(green("\nThread reset. ") + dim((res.facts || []).length + " fact(s) saved to memory.\n"));
      return;
    }
    if (line === "/reply") {
      const reply = clipRead().trim();
      if (!reply) { console.log(dim("(clipboard empty — copy the AI's reply first)\n")); return; }
      turns.push({ role: "assistant", content: reply });
      const t = pw.countTokens(reply);
      outTokens += t;
      console.log(green("captured reply ") + dim("(~" + t + " output tokens, " + reply.length + " chars)"));
      meter();
      return;
    }
    if (line.startsWith("/")) { console.log(dim("unknown command — /help\n")); return; }
    if (!line) return;

    // a message to the AI: optimize it, log the turn, copy to clipboard
    const out = provider ? await pw.optimizeWithLLM({ prompt: line, context: turns, signals: { surface: "desktop" } })
                         : pw.optimize({ prompt: line, context: turns, signals: { surface: "desktop" } });
    const r = out.rewrite;
    const finalText = out.suggestion ? out.suggestion.rewritten : r.rewritten;
    turns.push({ role: "user", content: finalText });
    origTokens += r.originalTokens;
    sentTokens += r.rewrittenTokens;
    savedTokens += r.tokensSaved;
    clipWrite(finalText);
    console.log(
      dim("optimized ") + r.originalTokens + "→" + green(String(r.rewrittenTokens)) +
      dim(" (-" + r.percentSaved + "%)") + (out.mode ? dim(" · " + out.mode) : "") + green("  ✓ copied to clipboard")
    );
    console.log(bold("send ▸ ") + finalText);
    meter();
  }

  rl.on("line", (line) => {
    handle(line.trim()).then(() => rl.prompt()).catch((e) => { console.error(dim(String(e.message || e))); rl.prompt(); });
  });
  rl.on("close", () => { saveMemory(pw.memory.toJSON()); console.log(dim("\nsession ended.")); process.exit(0); });
  rl.prompt();
}

// ---- interactive installer: `promptwise init` ----
const RC_START = "# >>> promptwise >>>";
const RC_END = "# <<< promptwise <<<";

function buildRcBlock(invoke, flags, agents, shell) {
  const f = flags ? " " + flags : "";
  const lines = [RC_START, "# PromptWise helpers — managed block (re-run `promptwise init` to update)"];
  if (/fish/.test(shell)) {
    lines.push("function pwo; " + invoke + " \"$argv\" --raw" + f + "; end");
    agents.forEach((a) => {
      lines.push("function " + a.fn + "; " + a.oneshot.replace("$OPT", "(" + invoke + " \"$argv\" --raw" + f + ")") + "; end");
    });
  } else {
    lines.push('pwo() { ' + invoke + ' "$*" --raw' + f + '; }   # print the optimized prompt');
    agents.forEach((a) => {
      lines.push(a.fn + '() { ' + a.oneshot.replace("$OPT", '$(' + invoke + ' "$*" --raw' + f + ')') + '; }   # ' + a.label + ', one-shot + optimized');
    });
  }
  lines.push(RC_END, "");
  return lines.join("\n");
}

function writeRcBlock(rcPath, block, dryRun) {
  let cur = "";
  try { cur = fs.readFileSync(rcPath, "utf8"); } catch (_) {}
  const re = new RegExp("\\n?" + RC_START + "[\\s\\S]*?" + RC_END + "\\n?", "g");
  const stripped = cur.replace(re, "\n").replace(/\n{3,}/g, "\n\n");
  const next = (stripped.endsWith("\n") || stripped === "" ? stripped : stripped + "\n") + "\n" + block;
  if (dryRun) return { path: rcPath, changed: true };
  fs.mkdirSync(path.dirname(rcPath), { recursive: true });
  if (cur) { try { fs.writeFileSync(rcPath + ".promptwise-bak", cur); } catch (_) {} }
  fs.writeFileSync(rcPath, next);
  return { path: rcPath, changed: true };
}

function installClaudeHook(invoke, dryRun) {
  const p = path.join(os.homedir(), ".claude", "settings.json");
  let s = {};
  try { s = JSON.parse(fs.readFileSync(p, "utf8")); } catch (_) {}
  s.hooks = s.hooks || {};
  s.hooks.UserPromptSubmit = s.hooks.UserPromptSubmit || [];
  const command = invoke + " hook";
  const already = JSON.stringify(s.hooks.UserPromptSubmit).indexOf("promptwise") !== -1 ||
    JSON.stringify(s.hooks.UserPromptSubmit).indexOf(" hook") !== -1;
  if (!already) s.hooks.UserPromptSubmit.push({ hooks: [{ type: "command", command: command }] });
  if (dryRun) return { path: p, changed: !already };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try { if (fs.existsSync(p)) fs.copyFileSync(p, p + ".promptwise-bak"); } catch (_) {}
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
  return { path: p, changed: !already };
}

function claudeDesktopConfigPath() {
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return path.join(home, ".config", "Claude", "claude_desktop_config.json");
}

function mcpServerPath() {
  try { return require.resolve("@promptwise-dev/mcp-server/server.js"); } catch (_) {}
  return path.resolve(path.dirname(path.resolve(process.argv[1])), "..", "mcp-server", "server.js");
}

function installDesktopMCP(dryRun) {
  const p = claudeDesktopConfigPath();
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(p, "utf8")); } catch (_) {}
  cfg.mcpServers = cfg.mcpServers || {};
  const already = !!cfg.mcpServers.promptwise;
  cfg.mcpServers.promptwise = { command: "node", args: [mcpServerPath()] };
  if (dryRun) return { path: p, changed: !already };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try { if (fs.existsSync(p)) fs.copyFileSync(p, p + ".promptwise-bak"); } catch (_) {}
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return { path: p, changed: !already };
}

function ask(rl, q, def) {
  return new Promise((resolve) => rl.question(q + (def ? dim(" [" + def + "] ") : " "), (a) => resolve((a || "").trim() || def || "")));
}
async function askYesNo(rl, q, defYes) {
  const a = (await ask(rl, q + (defYes ? " (Y/n)" : " (y/N)"))).toLowerCase();
  if (!a) return !!defYes;
  return a[0] === "y";
}

async function cmdInit(args) {
  const dryRun = !!args.flags["dry-run"];
  const auto = !!args.flags.yes || !!args.flags.y;
  const shell = process.env.SHELL || "zsh";
  const rcPath = rcFileFor(shell);
  const agents = detectAgents();
  const models = await ollamaUp(args.flags["ollama-host"]);
  const invoke = pwInvocation();

  console.log(bold("\nPromptWise setup\n"));
  console.log(dim("shell:   ") + shell + dim("  → ") + rcPath);
  console.log(dim("agents:  ") + (agents.length ? agents.map((a) => a.label).join(", ") : "none detected"));
  console.log(dim("ollama:  ") + (models ? green("running") + dim(" (" + (models.length ? models.join(", ") : "no models") + ")") : "not detected"));
  console.log("");

  // Defaults. Nothing touching another app's config is opted-in by default;
  // the shell rc + Claude Code hook are terminal-local. The Claude desktop
  // connector is only added on explicit consent (interactive yes, or
  // --with-desktop in non-interactive runs).
  let chosen = agents;
  let useLlm = !!(models && models.length);
  let brief = false;
  let installHook = agents.some((a) => a.bin === "claude");
  let installDesktop = !!args.flags["with-desktop"];
  let consent = auto; // --yes is itself consent for non-interactive runs

  if (!auto && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (agents.length) {
      const which = await ask(rl, "Set up shell wrappers for which agents? (comma names, or 'all')", "all");
      if (which !== "all") chosen = agents.filter((a) => which.toLowerCase().includes(a.bin) || which.toLowerCase().includes(a.label.toLowerCase()));
    }
    if (models && models.length) useLlm = await askYesNo(rl, "Use your local Ollama for deeper rewrites?", true);
    brief = await askYesNo(rl, "Also cap the model's answer length (saves output tokens)?", false);
    if (agents.some((a) => a.bin === "claude")) installHook = await askYesNo(rl, "Install the Claude Code memory/flood hook (interactive mode)?", true);
    installDesktop = await askYesNo(rl, "Also register the PromptWise connector in the Claude desktop app?", false);
    rl.close();
  }

  const flags = [useLlm ? "--llm" : "", brief ? "--brief" : ""].filter(Boolean).join(" ");
  const block = buildRcBlock(invoke, flags, chosen, shell);

  // Show exactly which files will change before touching anything.
  console.log(bold((dryRun ? "Planned changes" : "Changes") + " — nothing is written without your consent:\n"));
  console.log(dim("• ") + rcPath + dim("  (shell wrappers: pwo" + (chosen.length ? ", " + chosen.map((a) => a.fn).join(", ") : "") + ")"));
  if (installHook) console.log(dim("• ") + path.join(os.homedir(), ".claude", "settings.json") + dim("  (Claude Code UserPromptSubmit hook)"));
  if (installDesktop) console.log(dim("• ") + claudeDesktopConfigPath() + dim("  (Claude desktop MCP connector)"));
  console.log(dim("\nExisting files are backed up to *.promptwise-bak first.\n"));

  if (dryRun) {
    console.log(bold("rc block to be added:\n") + block);
    console.log(dim("Run without --dry-run to apply (you'll be asked to confirm)."));
    return;
  }

  // ---- consent gate ----
  if (!consent && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    consent = await askYesNo(rl, "Apply the changes above?", true);
    rl.close();
  }
  if (!consent) {
    console.log(yellow("Aborted — no changes made.") + dim(" (re-run and confirm, or use --yes / --dry-run)"));
    return;
  }

  writeRcBlock(rcPath, block, false);
  if (installHook) installClaudeHook(invoke, false);
  if (installDesktop) installDesktopMCP(false);

  console.log(green("\n✓ Installed.") + " Next:");
  console.log("  1. " + bold("source " + rcPath) + dim("  (or open a new terminal)"));
  if (chosen.some((a) => a.bin === "claude")) console.log("  2. Try: " + bold('ccp "could you please help me refactor this in order to clean it up"'));
  console.log("  •  " + dim('pwo "<prompt>"') + " prints the optimized prompt for any agent.");
  if (installHook) console.log("  •  " + dim("Claude Code interactive sessions now auto-inject your memory + flood nudges."));
  if (installDesktop) console.log("  •  " + dim("Restart Claude desktop to load the PromptWise connector."));
  console.log("");
}

async function cmdSummarize(args) {
  const file = args._[0] || args.flags.file;
  if (!file) {
    console.error("Usage: promptwise summarize <conversation.json> [--llm]");
    process.exit(1);
  }
  const messages = JSON.parse(fs.readFileSync(file, "utf8"));
  const provider = buildProvider(args);
  const pw = new PW.PromptWise({ memory: new PW.Memory(loadMemory()), provider });
  const res = await pw.summarizeThread(messages);
  if (args.flags.json) return console.log(JSON.stringify(res, null, 2));
  console.log(bold("\nSummary ") + dim("(" + res.mode + ")"));
  console.log(res.summary || dim("(no summary)"));
  if (res.facts && res.facts.length) {
    console.log(bold("\nDurable facts:"));
    res.facts.forEach((f) => console.log("  • " + f));
  }
  console.log("");
}

async function cmdMemory(args) {
  const sub = args._[0];
  let facts = loadMemory();
  if (sub === "add") {
    const m = new PW.Memory(facts);
    const fact = m.add(args._.slice(1).join(" "), { pinned: !!args.flags.pin });
    saveMemory(m.toJSON());
    console.log(fact ? green("Added: ") + fact.text + dim("  [" + fact.id + "]") : "Nothing to add.");
  } else if (sub === "curate") {
    const candidate = args._.slice(1).join(" ");
    if (!candidate) return console.error("Usage: promptwise memory curate \"<new fact>\" --llm");
    const provider = buildProvider(args);
    const m = new PW.Memory(facts);
    const pw = new PW.PromptWise({ memory: m, provider });
    const res = await pw.curateMemory([candidate]);
    saveMemory(pw.memory.toJSON());
    console.log(green("Memory curated ") + dim("(" + res.mode + ")") + " — now " + pw.memory.list().length + " fact(s).");
    if (res.removed && res.removed.length) console.log(dim("removed: " + res.removed.join("; ")));
  } else if (sub === "list" || !sub) {
    if (!facts.length) return console.log(dim("Memory is empty."));
    facts.forEach((f) =>
      console.log((f.pinned ? yellow("★ ") : "  ") + f.text + dim("  [" + f.id + "]"))
    );
  } else if (sub === "rm" || sub === "remove") {
    const id = args._[1];
    const m = new PW.Memory(facts);
    const ok = m.remove(id);
    saveMemory(m.toJSON());
    console.log(ok ? green("Removed " + id) : "No fact with id " + id);
  } else if (sub === "clear") {
    saveMemory([]);
    console.log(green("Memory cleared."));
  } else {
    console.error("Unknown memory command: " + sub);
  }
}

function cmdStats() {
  const s = loadStats();
  console.log(bold("\nPromptWise — lifetime savings"));
  console.log(dim("prompts optimized: ") + s.promptsOptimized);
  console.log(dim("tokens saved:      ") + green(String(s.tokensSaved)));
  console.log("");
}

function help() {
  console.log(`${bold("PromptWise CLI")} — smarter prompts, fewer tokens

${bold("Setup")}
  promptwise init                   interactive setup: detect agents + write shell wrappers
  promptwise init --dry-run         show what it would change, apply nothing
  promptwise init --yes             non-interactive (sensible defaults; your consent)
  promptwise init --with-desktop    also register the Claude desktop connector

${bold("Commands")}
  promptwise "<prompt>"              optimize a prompt (default)
  promptwise optimize -f <file>     optimize a prompt from a file
  echo "<prompt>" | promptwise      optimize from stdin
  promptwise session                live token/context tracker (clipboard round-trip)
  promptwise flood <conv.json>      analyze a conversation for context flooding
  promptwise summarize <conv.json>  summarize a thread (heuristic, or --llm)
  promptwise memory add "<fact>"    add a durable fact (use --pin to pin)
  promptwise memory curate "<fact>" merge a fact (dedupe/supersede) with --llm
  promptwise memory list            list memory
  promptwise memory rm <id>         remove a fact
  promptwise memory clear           wipe memory
  promptwise stats                  show lifetime token savings

${bold("Flags")}
  --llm                                 use a local Ollama model (streams output)
  --model <name>                        Ollama model (env OLLAMA_MODEL; def llama3.2:3b)
  --ollama-host <url>                   Ollama endpoint (env OLLAMA_HOST)
  --for-model <name>                    flag if that model is overkill for this task
  --raw                                 print ONLY the optimized prompt (for pipes/wrappers)
  --brief                               cap the answer length (output-token saving)
  --max-words <n>                       cap the answer to ~n words
  --surface <browser|ide|cli|desktop>   hint for persona detection
  --host <app>                          host app (vscode, claude-code, ...)
  --json                                machine-readable output

${bold("Examples")}
  promptwise "Could you please summarize this in order to save time" --llm --brief
  promptwise summarize chat.json --llm
  promptwise memory curate "We switched from pnpm to bun" --llm
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const first = argv[0];
  const args = parseArgs(argv);

  if (first === "-h" || first === "--help" || first === "help") return help();
  if (first === "init") { args._.shift(); return cmdInit(args); }
  if (first === "hook") return cmdHook();
  if (first === "flood") { args._.shift(); return cmdFlood(args); }
  if (first === "session") { args._.shift(); return cmdSession(args); }
  if (first === "summarize") { args._.shift(); return cmdSummarize(args); }
  if (first === "memory") { args._.shift(); return cmdMemory(args); }
  if (first === "stats") return cmdStats();
  if (first === "optimize") { args._.shift(); return cmdOptimize(args); }
  return cmdOptimize(args);
}

main().catch((e) => {
  console.error("Error: " + ((e && e.message) || e));
  process.exit(1);
});
