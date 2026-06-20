/**
 * persona.js — contextual persona & task inference.
 *
 * The same person is a Developer in their IDE and a Power Chatter in their
 * browser an hour later. We infer persona PER SURFACE and PER SESSION from
 * cheap signals (host surface, file types in context, code in the prompt,
 * prose intent) and emit a tailoring hint the rewrite engine can use.
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});

  var WRITING_RE = /\b(summari[sz]e|draft|write|rewrite|edit|proofread|blog|essay|email|report|article|caption|translate|tone)\b/i;
  var CODE_RE = /```|\b(function|class|const|let|var|import|def|return|async|await|npm|git|stack trace|exception|compile|refactor|bug|null pointer)\b/i;
  var IDE_HOSTS = ["vscode", "vs code", "intellij", "jetbrains", "pycharm", "webstorm"];
  var CLI_AGENTS = ["claude code", "claude-code", "auggie", "aider", "cursor-cli"];

  function detect(signals) {
    signals = signals || {};
    var surface = (signals.surface || "unknown").toLowerCase();
    var host = (signals.hostApp || "").toLowerCase();
    var fileTypes = signals.fileTypes || [];
    var prompt = signals.promptText || "";
    var threadLength = signals.threadLength || 0;

    var hasCode = CODE_RE.test(prompt) || fileTypes.length > 0;
    var isWriting = WRITING_RE.test(prompt);
    var reasons = [];
    var persona = "generic";
    var confidence = 0.4;

    if (
      surface === "ide" ||
      IDE_HOSTS.indexOf(host) !== -1 ||
      CLI_AGENTS.indexOf(host) !== -1 ||
      (surface === "cli" && hasCode) ||
      hasCode
    ) {
      persona = "developer";
      confidence = surface === "ide" || hasCode ? 0.85 : 0.6;
      reasons.push(
        surface === "ide" || IDE_HOSTS.indexOf(host) !== -1
          ? "running inside an IDE"
          : hasCode
          ? "prompt contains code or technical terms"
          : "command-line coding agent"
      );
    } else if (isWriting) {
      persona = "analyst-writer";
      confidence = 0.7;
      reasons.push("prompt asks for writing/analysis");
    } else if (surface === "browser" && threadLength >= 12) {
      persona = "power-chatter";
      confidence = 0.65;
      reasons.push("long browser chat thread");
    } else if (surface === "browser") {
      persona = "power-chatter";
      confidence = 0.45;
      reasons.push("browser chat surface");
    }

    return {
      persona: persona,
      confidence: confidence,
      reasons: reasons,
      tailoring: TAILORING[persona],
      task: isWriting ? "writing" : hasCode ? "coding" : "general",
    };
  }

  var TAILORING = {
    developer: {
      style: "terse, imperative, code-first",
      note: "Strip pleasantries; keep identifiers, signatures, and error text exact.",
    },
    "power-chatter": {
      style: "concise, reference prior context instead of restating",
      note: "Lean on conversation history and memory; avoid re-pasting earlier content.",
    },
    "analyst-writer": {
      style: "clear instruction, preserve audience/format/tone constraints",
      note: "Compress instructions but keep explicit length, tone, and format asks.",
    },
    "team-lead": {
      style: "standardized, shared-memory aware",
      note: "Apply shared prompt standards; surface spend.",
    },
    generic: {
      style: "concise and unambiguous",
      note: "Remove filler; preserve all explicit constraints.",
    },
  };

  var api = { detect: detect, TAILORING: TAILORING };
  PW.persona = api;
  if (isNode) module.exports = api;
})();
