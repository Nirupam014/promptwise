"use strict";
/* PromptWise desktop renderer — UI only; all engine work is in the main process. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var lastResult = null;

  function setStatus() {
    window.pw.status().then(function (s) {
      var el = $("status");
      if (!s || s.backend === "off") { el.textContent = "heuristic"; el.className = "pill"; return; }
      if (s.reachable && s.allowed && s.hasModel) { el.textContent = "LLM · " + s.model; el.className = "pill ok"; }
      else if (s.reachable === false) { el.textContent = "Ollama offline"; el.className = "pill bad"; }
      else if (s.allowed === false) { el.textContent = "Ollama blocked"; el.className = "pill bad"; }
      else if (s.hasModel === false) { el.textContent = "model missing"; el.className = "pill bad"; }
      else { el.textContent = "LLM"; el.className = "pill"; }
    });
  }

  function render(result) {
    lastResult = result;
    var r = result.rewrite;
    var text = result.suggestion ? result.suggestion.rewritten : r.rewritten;
    $("out").classList.remove("streaming");
    $("out").textContent = text;
    var mode = result.mode ? " · " + result.mode : "";
    $("meta").textContent =
      result.persona.persona + mode + "  ·  " + r.originalTokens + " → " + r.rewrittenTokens +
      " tokens (-" + r.percentSaved + "%)" +
      (result.llm && result.llm.rejected ? "  ·  LLM rejected: " + result.llm.reason : "") +
      (result.llm && result.llm.error ? "  ·  LLM offline, used heuristic" : "");
    $("copy").disabled = false;
    $("copy-only").disabled = false;
  }

  function run(useLlm) {
    var prompt = $("input").value.trim();
    if (!prompt) return;
    saveBriefIntoSettings();
    $("optimize").disabled = $("optimize-llm").disabled = true;
    $("out").textContent = "";
    if (useLlm) { $("out").classList.add("streaming"); $("meta").textContent = "streaming from local LLM…"; }
    window.pw
      .optimize({ prompt: prompt, useLlm: useLlm })
      .then(render)
      .catch(function (e) { $("meta").textContent = "error: " + (e && e.message ? e.message : e); })
      .then(function () { $("optimize").disabled = $("optimize-llm").disabled = false; });
  }

  // brief checkbox toggles outputBudget in settings before each run
  function saveBriefIntoSettings() {
    window.pw.getSettings().then(function (s) {
      s.outputBudget = { enabled: $("brief").checked, words: (s.outputBudget && s.outputBudget.words) || 120 };
      window.pw.setSettings(s);
    });
  }

  // live token streaming
  window.pw.onToken(function (tok) {
    var out = $("out");
    out.classList.add("streaming");
    out.textContent += tok;
  });

  // when shown via hotkey, prefill from clipboard and focus
  window.pw.onShow(function (d) {
    if (d && d.clipboard && !$("input").value.trim()) $("input").value = d.clipboard;
    $("input").focus();
    $("input").select();
    setStatus();
  });

  $("optimize").addEventListener("click", function () { run(false); });
  $("optimize-llm").addEventListener("click", function () { run(true); });
  $("copy").addEventListener("click", function () {
    if (!lastResult) return;
    var t = lastResult.suggestion ? lastResult.suggestion.rewritten : lastResult.rewrite.rewritten;
    window.pw.copy(t).then(function () { window.pw.hide(); });
  });
  $("copy-only").addEventListener("click", function () {
    if (!lastResult) return;
    var t = lastResult.suggestion ? lastResult.suggestion.rewritten : lastResult.rewrite.rewritten;
    window.pw.copy(t);
    $("copy-only").textContent = "Copied";
    setTimeout(function () { $("copy-only").textContent = "Copy"; }, 1000);
  });
  $("close").addEventListener("click", function () { window.pw.hide(); });
  $("gear").addEventListener("click", function () { $("settings").classList.toggle("on"); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") window.pw.hide();
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run($("optimize-llm").disabled ? false : true);
  });

  // settings
  function loadSettingsUI() {
    window.pw.getSettings().then(function (s) {
      $("set-backend").value = s.llm.backend;
      $("set-endpoint").value = s.llm.endpoint;
      $("set-model").value = s.llm.model;
      $("brief").checked = !!(s.outputBudget && s.outputBudget.enabled);
    });
  }
  function saveSettingsUI() {
    window.pw.getSettings().then(function (s) {
      s.llm = { backend: $("set-backend").value, endpoint: $("set-endpoint").value.trim() || "http://localhost:11434", model: $("set-model").value.trim() || "llama3.2:3b" };
      window.pw.setSettings(s).then(setStatus);
    });
  }
  ["set-backend", "set-endpoint", "set-model"].forEach(function (id) {
    $(id).addEventListener("change", saveSettingsUI);
  });

  loadSettingsUI();
  setStatus();
})();
