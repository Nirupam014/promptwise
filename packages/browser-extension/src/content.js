/**
 * PromptWise content script.
 *
 * Watches the chat composer on supported AI sites, runs the local rewrite
 * engine on what you've typed, and offers a one-click tighter rewrite. Also
 * watches thread length and nudges you to start fresh when context floods.
 *
 * The engine is fully local (the vendor/core/*.js files loaded before this).
 * Nothing leaves the page.
 */
(function () {
  "use strict";
  try { console.info("[PromptWise] content script loaded on " + location.host); } catch (e) {}

  var Core = (typeof globalThis !== "undefined" ? globalThis : window).PromptWiseCore || window.PromptWiseCore;
  if (!Core || !Core.engine) {
    try {
      console.warn(
        "[PromptWise] engine not assembled — PromptWiseCore = " +
          (Core ? "{" + Object.keys(Core).join(",") + "}" : "undefined") +
          ". The vendor/core scripts may not have loaded before content.js."
      );
    } catch (e) {}
    return;
  }

  var MIN_TOKENS = 8; // don't bother on tiny prompts
  var MIN_SAVING = 3; // tokens
  var DEBOUNCE_MS = 500;

  var pw;
  try {
    pw = new Core.engine.PromptWise();
  } catch (e) {
    try { console.error("[PromptWise] failed to init engine:", e); } catch (_) {}
    return;
  }
  var hostKey = location.hostname;
  var lastText = "";
  var chip = null;
  var banner = null;
  var dismissedFor = ""; // text we already dismissed a suggestion for
  var llmReady = false; // is a local LLM backend configured + available?

  // ---- load memory + settings from extension storage ----
  var enabled = true;
  var lastSummary = null; // last LLM thread summary, for "start fresh chat"
  try {
    chrome.storage.local.get(["pw_memory", "pw_enabled", "pw_brevity", "pw_aggressive"], function (res) {
      if (res && res.pw_memory) {
        (res.pw_memory || []).forEach(function (f) { pw.memory.add(f.text || f, { pinned: f.pinned }); });
      }
      enabled = res && res.pw_enabled === false ? false : true;
      applyEngineConfig(res || {});
      maybePrefillFromReset();
    });
    chrome.storage.onChanged.addListener(function (changes) {
      if (changes.pw_enabled) enabled = changes.pw_enabled.newValue !== false;
      if (changes.pw_memory) {
        pw.memory = new Core.memory.Memory(changes.pw_memory.newValue || []);
      }
      if (changes.pw_llm) refreshLlmStatus();
      if (changes.pw_brevity || changes.pw_aggressive) {
        chrome.storage.local.get(["pw_brevity", "pw_aggressive"], applyEngineConfig);
      }
    });
    refreshLlmStatus();
  } catch (e) {
    /* storage unavailable in some contexts; engine still works */
  }

  // Apply output-brevity + context-trimming settings to the engine.
  function applyEngineConfig(res) {
    var brev = res.pw_brevity || {};
    pw.outputBudget = brev.enabled ? { words: brev.words || 120, noPreamble: true } : null;
    pw.config = pw.config || {};
    pw.config.contextDropThreshold = res.pw_aggressive ? 0.6 : undefined;
  }

  // When the user started a fresh chat via PromptWise, prefill the saved summary.
  function maybePrefillFromReset() {
    chrome.storage.local.get(["pw_pending_summary"], function (st) {
      var pending = st && st.pw_pending_summary;
      if (!pending) return;
      chrome.storage.local.remove("pw_pending_summary");
      var tries = 0;
      var iv = setInterval(function () {
        var composer = findComposer();
        if (composer && !getText(composer).trim()) {
          setText(composer, pending);
          clearInterval(iv);
        } else if (++tries > 20) {
          clearInterval(iv);
        }
      }, 400);
    });
  }

  // Ask the background worker whether a local LLM is configured and reachable.
  function refreshLlmStatus() {
    sendBG({ type: "PW_LLM_STATUS" })
      .then(function (s) { llmReady = !!(s && s.ready); })
      .catch(function () { llmReady = false; });
  }

  // ---- host-specific composer + thread accessors ----
  function findComposer() {
    var sels = [
      "#prompt-textarea", // ChatGPT
      'div.ProseMirror[contenteditable="true"]', // Claude / ChatGPT rich editor
      "textarea[data-testid='prompt-textarea']",
      "rich-textarea .ql-editor", // Gemini
      'div[contenteditable="true"][role="textbox"]',
      "main textarea",
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el) return el;
    }
    return null;
  }

  function getText(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value;
    return el.innerText || el.textContent || "";
  }

  function setText(el, value) {
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      var setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // contenteditable
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  }

  // Best-effort: read the currently selected model from the page's switcher.
  function getSelectedModel() {
    var sels = [
      '[data-testid="model-switcher-dropdown-button"]', // ChatGPT
      'button[aria-label*="Model"]',
      '[data-testid="model-selector-dropdown"]', // Claude
      'button[data-testid="model-selector"]',
      "button[aria-haspopup='listbox']",
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el) {
        var t = (el.innerText || el.textContent || "").trim();
        if (t && t.length < 40) return t;
      }
    }
    return "";
  }

  function getThreadMessages() {
    // Best-effort: collect visible conversation turns for flood analysis.
    var nodes = document.querySelectorAll(
      '[data-message-author-role], [data-testid^="conversation-turn"], .font-claude-message, .conversation-container .model-response-text, [data-message-id]'
    );
    var msgs = [];
    nodes.forEach(function (n) {
      var role = n.getAttribute("data-message-author-role") || "user";
      var t = (n.innerText || "").trim();
      if (t) msgs.push({ role: role, content: t });
    });
    return msgs;
  }

  // DOM builder — avoids innerHTML so we never touch the page's Trusted Types /
  // CSP, and is simpler to reason about.
  function mk(tag, cls, text, title) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (title) e.title = title;
    return e;
  }

  // ---- suggestion chip UI ----
  function removeChip() {
    if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
    chip = null;
  }

  function showChip(composer, result, hasTokens) {
    removeChip();
    // When there's no token saving but the model is overkill, synthesize a
    // minimal suggestion so the chip can show the model nudge alone.
    var s = result.suggestion || { headline: "Model may be overkill", rewritten: result.rewrite.rewritten, reasons: [] };
    var modelNudge = result.modelFit && result.modelFit.overkill ? result.modelFit : null;

    chip = mk("div", "pw-chip");
    chip.appendChild(mk("span", "pw-spark", "✦"));
    chip.appendChild(mk("span", "pw-headline"));
    chip.appendChild(mk("button", "pw-deep", "✦ Deep", "Rewrite with local LLM"));
    chip.appendChild(mk("button", "pw-apply", "Apply"));
    chip.appendChild(mk("button", "pw-why", "ⓘ", "Why?"));
    chip.appendChild(mk("button", "pw-x", "✕", "Dismiss"));
    var popEl = mk("div", "pw-pop");
    popEl.appendChild(mk("div", "pw-pop-reasons"));
    popEl.appendChild(mk("div", "pw-pop-label", "Preview"));
    popEl.appendChild(mk("div", "pw-pop-preview"));
    chip.appendChild(popEl);
    chip.querySelector(".pw-headline").textContent = s.headline + (modelNudge ? " · ⚠ model" : "");
    chip.querySelector(".pw-pop-preview").textContent = s.rewritten;

    // If only a model nudge (no real rewrite), hide the rewrite actions.
    if (!hasTokens) {
      chip.querySelector(".pw-apply").style.display = "none";
      chip.querySelector(".pw-deep").style.display = "none";
      popEl.querySelector(".pw-pop-label").style.display = "none";
      chip.querySelector(".pw-pop-preview").style.display = "none";
    }

    // current best suggestion the chip is showing (heuristic, upgradable to LLM)
    var current = { suggestion: s, saved: result.rewrite.tokensSaved };
    var rs = chip.querySelector(".pw-pop-reasons");
    if (modelNudge) {
      var mw = mk("div", "pw-reason pw-model-warn", "⚠ " + modelNudge.message);
      rs.appendChild(mw);
    }
    s.reasons.forEach(function (r) {
      var li = document.createElement("div");
      li.className = "pw-reason";
      li.textContent = "• " + r;
      rs.appendChild(li);
    });

    chip.querySelector(".pw-apply").addEventListener("click", function () {
      setText(composer, current.suggestion.rewritten);
      bumpStats(current.saved);
      removeChip();
    });
    chip.querySelector(".pw-x").addEventListener("click", function () {
      dismissedFor = lastText;
      removeChip();
    });
    var pop = chip.querySelector(".pw-pop");
    chip.querySelector(".pw-why").addEventListener("click", function () {
      pop.classList.toggle("pw-show");
    });

    var deepBtn = chip.querySelector(".pw-deep");
    deepBtn.addEventListener("click", function () {
      runDeep(composer, result, current, deepBtn);
    });

    document.body.appendChild(chip);
    positionChip(composer);

    // If the LLM is enabled and ready, upgrade automatically in the background
    // (only when there's an actual rewrite to upgrade).
    if (hasTokens && llmReady) runDeep(composer, result, current, deepBtn, true);
  }

  // Run the local LLM via a streaming port: tokens fill the preview live, then
  // the chip swaps to the final verified rewrite if it beats the heuristic.
  function runDeep(composer, result, current, deepBtn, silent) {
    if (!chip) return;
    deepBtn.textContent = "✦ …";
    deepBtn.disabled = true;
    var preview = chip.querySelector(".pw-pop-preview");
    var thread = getThreadMessages();

    var port;
    try {
      port = chrome.runtime.connect({ name: "pw-deep" });
    } catch (e) {
      // streaming unavailable — fall back to one-shot
      return runDeepOneShot(result, current, deepBtn, silent);
    }

    var streamed = false;
    port.onMessage.addListener(function (m) {
      if (!chip) { try { port.disconnect(); } catch (e) {} return; }
      if (m.token != null) {
        streamed = true;
        deepBtn.textContent = "✦ ▍";
        preview.textContent = m.full; // live preview of the LLM output
        return;
      }
      if (m.done) {
        deepBtn.disabled = false;
        var out = m.result;
        if (out && out.mode === "llm" && out.suggestion && out.rewrite.tokensSaved >= current.saved) {
          current.suggestion = out.suggestion;
          current.saved = out.rewrite.tokensSaved;
          chip.querySelector(".pw-headline").textContent = out.suggestion.headline + " · LLM";
          preview.textContent = out.suggestion.rewritten;
          deepBtn.textContent = "✦ LLM";
          deepBtn.classList.add("pw-deep-on");
        } else {
          if (streamed) preview.textContent = current.suggestion.rewritten; // revert preview
          deepBtn.textContent = silent ? "✦ Deep" : "✦ kept";
          if (!silent) setTimeout(function () { if (deepBtn) deepBtn.textContent = "✦ Deep"; }, 1500);
        }
        try { port.disconnect(); } catch (e) {}
      }
    });
    port.onDisconnect.addListener(function () {
      if (deepBtn && deepBtn.disabled) { deepBtn.disabled = false; deepBtn.textContent = "✦ Deep"; }
    });
    port.postMessage({ prompt: result.rewrite.original, context: thread, host: hostKey });
  }

  // Non-streaming fallback.
  function runDeepOneShot(result, current, deepBtn, silent) {
    sendBG({ type: "PW_OPTIMIZE_LLM", prompt: result.rewrite.original, context: getThreadMessages(), host: hostKey })
      .then(function (out) {
        if (!chip) return;
        deepBtn.disabled = false;
        if (out && out.mode === "llm" && out.suggestion && out.rewrite.tokensSaved >= current.saved) {
          current.suggestion = out.suggestion;
          current.saved = out.rewrite.tokensSaved;
          chip.querySelector(".pw-headline").textContent = out.suggestion.headline + " · LLM";
          chip.querySelector(".pw-pop-preview").textContent = out.suggestion.rewritten;
          deepBtn.textContent = "✦ LLM";
          deepBtn.classList.add("pw-deep-on");
        } else {
          deepBtn.textContent = silent ? "✦ Deep" : "✦ kept";
        }
      })
      .catch(function () {
        if (deepBtn) { deepBtn.disabled = false; deepBtn.textContent = "✦ Deep"; }
      });
  }

  // Promise wrapper around chrome.runtime.sendMessage.
  function sendBG(msg) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(msg, function (resp) {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          resolve(resp);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function positionChip(composer) {
    if (!chip) return;
    var r = composer.getBoundingClientRect();
    chip.style.left = Math.max(8, r.left) + "px";
    chip.style.top = Math.max(8, r.top - 44) + "px";
  }

  // ---- flood banner ----
  function showBanner(flood) {
    if (banner) return;
    banner = mk("div", "pw-banner pw-" + flood.recommendation);
    banner.appendChild(mk("span", "pw-spark", "✦"));
    banner.appendChild(mk("span", "pw-banner-text"));
    // Primary CTA — always shown. Works without an LLM (heuristic fact
    // extraction); a local LLM just makes the summary richer.
    banner.appendChild(mk("button", "pw-banner-go", "Summarize & save"));
    banner.appendChild(mk("button", "pw-banner-x", "Dismiss"));
    banner.querySelector(".pw-banner-text").textContent = flood.message;
    banner.querySelector(".pw-banner-x").addEventListener("click", closeBanner);

    var go = banner.querySelector(".pw-banner-go");
    if (go) {
      go.addEventListener("click", function () {
        go.textContent = "Summarizing…";
        go.disabled = true;
        sendBG({ type: "PW_SUMMARIZE", messages: getThreadMessages() })
          .then(function (res) {
            // Persist the distilled facts into global memory so a fresh chat keeps them.
            if (res && res.facts && res.facts.length) {
              chrome.storage.local.get(["pw_memory"], function (st) {
                var mem = (st && st.pw_memory) || [];
                res.facts.forEach(function (f) {
                  mem.push({ text: f, pinned: false, createdAt: new Date().toISOString() });
                });
                chrome.storage.local.set({ pw_memory: mem });
              });
            }
            lastSummary = buildResetSeed(res);
            banner.querySelector(".pw-banner-text").textContent =
              (res && res.summary ? "Saved a summary + " : "Saved ") +
              ((res && res.facts && res.facts.length) || 0) +
              " fact(s) to memory.";
            go.remove();
            // Offer to open a fresh chat seeded with the compact summary — this
            // is the real input-token win: it stops the whole thread being
            // re-sent every turn.
            var fresh = document.createElement("button");
            fresh.className = "pw-banner-go";
            fresh.textContent = "Start fresh chat";
            fresh.addEventListener("click", function () {
              chrome.storage.local.set({ pw_pending_summary: lastSummary }, function () {
                window.location.href = newChatUrl();
              });
            });
            banner.insertBefore(fresh, banner.querySelector(".pw-banner-x"));
          })
          .catch(function () {
            go.textContent = "Summarize & save";
            go.disabled = false;
          });
      });
    }
    document.body.appendChild(banner);
  }

  // Compose the seed message for a fresh chat from the summary + facts.
  function buildResetSeed(res) {
    var lines = ["Context carried over from a previous chat:"];
    if (res && res.summary) lines.push("", res.summary);
    if (res && res.facts && res.facts.length) {
      lines.push("", "Key facts:");
      res.facts.forEach(function (f) { lines.push("- " + f); });
    }
    return lines.join("\n");
  }

  // Host-specific "new chat" URL.
  function newChatUrl() {
    if (/claude\.ai/.test(hostKey)) return "https://claude.ai/new";
    if (/gemini\.google\.com/.test(hostKey)) return "https://gemini.google.com/app";
    return "https://" + hostKey + "/"; // ChatGPT and most others land on a new chat
  }

  function closeBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  function bumpStats(saved) {
    try {
      chrome.storage.local.get(["pw_stats"], function (res) {
        var s = (res && res.pw_stats) || { promptsOptimized: 0, tokensSaved: 0 };
        s.promptsOptimized += 1;
        s.tokensSaved += saved || 0;
        chrome.storage.local.set({ pw_stats: s });
      });
    } catch (e) {}
  }

  // ---- main loop ----
  var timer = null;
  function onInput(composer) {
    if (!enabled) return removeChip();
    clearTimeout(timer);
    timer = setTimeout(function () {
      var textVal = getText(composer).trim();
      lastText = textVal;
      if (!textVal || textVal === dismissedFor) return removeChip();
      if (pw.countTokens(textVal) < MIN_TOKENS) return removeChip();

      var thread = getThreadMessages();
      var result = pw.optimize({
        prompt: textVal,
        context: thread,
        signals: { surface: "browser", hostApp: hostKey, threadLength: thread.length, model: getSelectedModel() },
      });

      var hasTokens = result.suggestion && result.rewrite.tokensSaved >= MIN_SAVING;
      var hasModelNudge = result.modelFit && result.modelFit.overkill;
      if (hasTokens || hasModelNudge) {
        showChip(composer, result, hasTokens);
      } else {
        removeChip();
      }
    }, DEBOUNCE_MS);
  }

  function checkFlood() {
    if (!enabled) return;
    var msgs = getThreadMessages();
    if (msgs.length < 8) return;
    var flood = pw.analyzeConversation(msgs);
    if (flood.recommendation !== "none") showBanner(flood);
  }

  // Robust binding: listen for input on ANY editable at the document level in
  // the capture phase. This survives the chat app swapping out its composer on
  // SPA navigation, and doesn't depend on one exact selector matching.
  var bound = null;
  function isEditable(el) {
    return !!el && (el.tagName === "TEXTAREA" || el.isContentEditable);
  }
  function handleEditableEvent(e) {
    var t = e.target;
    if (!isEditable(t)) return;
    bound = t;
    onInput(t);
  }
  document.addEventListener("input", handleEditableEvent, true);
  document.addEventListener("keyup", handleEditableEvent, true);

  setInterval(checkFlood, 8000);
  window.addEventListener("scroll", function () { if (chip && bound) positionChip(bound); }, true);
  window.addEventListener("resize", function () { if (chip && bound) positionChip(bound); });

  // One-line confirmation in the page console that PromptWise is live.
  try { console.info("[PromptWise] active on " + location.host + " — type a prompt to see suggestions."); } catch (e) {}
})();
