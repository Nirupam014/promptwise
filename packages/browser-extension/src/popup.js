/* PromptWise popup — stats, on/off toggle, and global-memory management. */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  function render() {
    chrome.storage.local.get(["pw_enabled", "pw_memory", "pw_stats"], function (res) {
      $("enabled").checked = res.pw_enabled !== false;
      var stats = res.pw_stats || { promptsOptimized: 0, tokensSaved: 0 };
      $("s-prompts").textContent = stats.promptsOptimized;
      $("s-tokens").textContent = stats.tokensSaved;
      renderMemory(res.pw_memory || []);
    });
  }

  function renderMemory(mem) {
    var ul = $("mem-list");
    ul.innerHTML = "";
    if (!mem.length) {
      var li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No facts yet. Add things you repeat in every chat.";
      ul.appendChild(li);
      return;
    }
    mem.forEach(function (f, i) {
      var li = document.createElement("li");
      var txt = document.createElement("span");
      txt.className = "txt";
      txt.textContent = (f.pinned ? "★ " : "") + (f.text || f);
      var del = document.createElement("button");
      del.className = "del";
      del.textContent = "✕";
      del.addEventListener("click", function () {
        mem.splice(i, 1);
        chrome.storage.local.set({ pw_memory: mem }, render);
      });
      li.appendChild(txt);
      li.appendChild(del);
      ul.appendChild(li);
    });
  }

  function addMemory() {
    var v = $("mem-input").value.trim();
    if (!v) return;
    chrome.storage.local.get(["pw_memory"], function (res) {
      var mem = res.pw_memory || [];
      mem.push({ text: v, pinned: false, createdAt: new Date().toISOString() });
      chrome.storage.local.set({ pw_memory: mem }, function () {
        $("mem-input").value = "";
        render();
      });
    });
  }

  // ---- Local LLM settings ----
  var DEFAULT_LLM = {
    backend: "off",
    endpoint: "http://localhost:11434",
    ollamaModel: "llama3.2:3b",
    webllmModel: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
  };

  function renderLlm() {
    chrome.storage.local.get(["pw_llm"], function (res) {
      var s = Object.assign({}, DEFAULT_LLM, res.pw_llm || {});
      $("llm-backend").value = s.backend;
      $("llm-endpoint").value = s.endpoint;
      setModelOptions([s.ollamaModel], s.ollamaModel);
      $("llm-webllm-model").value = s.webllmModel;
      toggleFields(s.backend);
      if (s.backend === "ollama") refreshModels(s.ollamaModel);
    });
  }

  // Populate the model <select>; keep `selected` chosen even if not yet listed.
  function setModelOptions(models, selected) {
    var sel = $("llm-ollama-model");
    var list = models.slice();
    if (selected && list.indexOf(selected) === -1) list.unshift(selected);
    sel.innerHTML = "";
    list.forEach(function (m) {
      var o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      if (m === selected) o.selected = true;
      sel.appendChild(o);
    });
  }

  function refreshModels(selected) {
    try {
      chrome.runtime.sendMessage({ type: "PW_OLLAMA_MODELS" }, function (resp) {
        if (chrome.runtime.lastError || !resp || !resp.models) return;
        var cur = selected || $("llm-ollama-model").value;
        if (resp.models.length) setModelOptions(resp.models, cur);
      });
    } catch (e) {}
  }

  function toggleFields(backend) {
    $("llm-ollama").classList.toggle("on", backend === "ollama");
    $("llm-webllm").classList.toggle("on", backend === "webllm");
  }

  function saveLlm() {
    var s = {
      backend: $("llm-backend").value,
      endpoint: $("llm-endpoint").value.trim() || DEFAULT_LLM.endpoint,
      ollamaModel: $("llm-ollama-model").value.trim() || DEFAULT_LLM.ollamaModel,
      webllmModel: $("llm-webllm-model").value.trim() || DEFAULT_LLM.webllmModel,
    };
    chrome.storage.local.set({ pw_llm: s });
    return s;
  }

  $("llm-backend").addEventListener("change", function () {
    var b = $("llm-backend").value;
    toggleFields(b);
    saveLlm();
    setStatus("—", "");
    if (b === "ollama") refreshModels();
  });
  ["llm-endpoint", "llm-ollama-model", "llm-webllm-model"].forEach(function (id) {
    $(id).addEventListener("change", saveLlm);
  });
  $("llm-refresh").addEventListener("click", function () { refreshModels(); });

  // Pull a model from the popup, streaming download progress over a port.
  $("llm-pull").addEventListener("click", function () {
    var name = $("llm-pull-name").value.trim();
    if (!name) return;
    saveLlm();
    var statusEl = $("llm-pull-status");
    statusEl.textContent = "starting…";
    statusEl.className = "status";
    var port;
    try {
      port = chrome.runtime.connect({ name: "pw-pull" });
    } catch (e) {
      statusEl.textContent = "pull unavailable";
      statusEl.className = "status bad";
      return;
    }
    port.onMessage.addListener(function (m) {
      if (m.progress) {
        var p = m.progress;
        if (p.total && p.completed != null) {
          statusEl.textContent = p.status + " " + Math.round((p.completed / p.total) * 100) + "%";
        } else if (p.status) {
          statusEl.textContent = p.status;
        }
      }
      if (m.done) {
        statusEl.textContent = m.error ? "error: " + m.error : "pulled " + name;
        statusEl.className = "status " + (m.error ? "bad" : "ok");
        if (!m.error) { $("llm-pull-name").value = ""; refreshModels(name); }
        try { port.disconnect(); } catch (e) {}
      }
    });
    port.postMessage({ model: name });
  });

  function setStatus(text, cls) {
    var el = $("llm-status");
    el.textContent = text;
    el.className = "status" + (cls ? " " + cls : "");
  }

  function hideFix() { $("llm-fix").style.display = "none"; }
  function showFix(message, cmd) {
    $("llm-fix-msg").textContent = message;
    $("llm-fix-cmd").textContent = cmd;
    $("llm-fix-cmd").style.display = cmd ? "block" : "none";
    $("llm-fix-copy").style.display = cmd ? "" : "none";
    $("llm-fix").style.display = "block";
  }
  $("llm-fix-copy").addEventListener("click", function () {
    var cmd = $("llm-fix-cmd").textContent;
    if (cmd && navigator.clipboard) navigator.clipboard.writeText(cmd);
    $("llm-fix-copy").textContent = "Copied";
    setTimeout(function () { $("llm-fix-copy").textContent = "Copy"; }, 1200);
  });

  $("llm-test").addEventListener("click", function () {
    saveLlm();
    setStatus("checking…", "");
    hideFix();
    try {
      chrome.runtime.sendMessage({ type: "PW_LLM_STATUS" }, function (resp) {
        if (chrome.runtime.lastError || !resp) return setStatus("no response", "bad");
        if (resp.backend === "off") return setStatus("disabled", "");

        if (resp.backend === "ollama") {
          if (!resp.reachable) {
            setStatus("can't reach Ollama", "bad");
            showFix(
              "Ollama isn't responding. Make sure it's running, and that it allows this extension. Start it with:",
              'OLLAMA_ORIGINS="' + (resp.origin || "chrome-extension://*") + '" ollama serve'
            );
            return;
          }
          if (resp.allowed === false) {
            setStatus("running, but blocking this extension", "bad");
            showFix(
              "Ollama is running but rejected this extension's origin. Restart it allowing this origin:",
              'OLLAMA_ORIGINS="' + (resp.origin || "chrome-extension://*") + '" ollama serve'
            );
            return;
          }
          if (resp.hasModel === false) {
            setStatus("running · model '" + resp.model + "' not installed", "bad");
            showFix("That model isn't pulled yet. Type it in the Pull box above and click Pull (or run:)", "ollama pull " + resp.model);
            return;
          }
          setStatus("ready · " + resp.model, "ok");
          return;
        }

        if (resp.ready) setStatus("ready · " + (resp.model || resp.backend), "ok");
        else setStatus("unavailable" + (resp.error ? " (" + resp.error + ")" : ""), "bad");
      });
    } catch (e) {
      setStatus("error", "bad");
    }
  });

  // ---- Token-saving settings ----
  function renderSaving() {
    chrome.storage.local.get(["pw_brevity", "pw_aggressive"], function (res) {
      var b = res.pw_brevity || { enabled: false, words: 120 };
      $("brevity").checked = !!b.enabled;
      $("brevity-words").value = b.words || 120;
      $("brevity-words-row").style.display = b.enabled ? "" : "none";
      $("aggressive").checked = !!res.pw_aggressive;
    });
  }
  function saveBrevity() {
    var enabled = $("brevity").checked;
    $("brevity-words-row").style.display = enabled ? "" : "none";
    chrome.storage.local.set({
      pw_brevity: { enabled: enabled, words: parseInt($("brevity-words").value, 10) || 120 },
    });
  }
  $("brevity").addEventListener("change", saveBrevity);
  $("brevity-words").addEventListener("change", saveBrevity);
  $("aggressive").addEventListener("change", function () {
    chrome.storage.local.set({ pw_aggressive: $("aggressive").checked });
  });

  $("enabled").addEventListener("change", function () {
    chrome.storage.local.set({ pw_enabled: $("enabled").checked });
  });
  $("mem-add").addEventListener("click", addMemory);
  $("mem-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter") addMemory();
  });
  $("mem-clear").addEventListener("click", function () {
    chrome.storage.local.set({ pw_memory: [] }, render);
  });

  render();
  renderLlm();
  renderSaving();
})();
