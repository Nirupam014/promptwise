/**
 * llm/ollama.js — provider adapter for a local Ollama server.
 *
 * Talks to Ollama's HTTP API (default http://localhost:11434) using fetch,
 * which exists in Node 18+ and the browser, so this adapter is dependency-free
 * and runs on every surface. The browser extension must call it from a context
 * allowed by Ollama's OLLAMA_ORIGINS setting.
 *
 *   createOllamaProvider({ endpoint, model, fetchImpl, temperature })
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});

  function createOllamaProvider(opts) {
    opts = opts || {};
    var endpoint = (opts.endpoint || "http://localhost:11434").replace(/\/+$/, "");
    var model = opts.model || "llama3.2:3b";
    var temperature = opts.temperature == null ? 0 : opts.temperature;
    var doFetch = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(root) : null);
    if (!doFetch) throw new Error("No fetch available for Ollama provider");

    function info() {
      return { backend: "ollama", model: model, endpoint: endpoint };
    }

    function available() {
      return doFetch(endpoint + "/api/tags", { method: "GET" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || !Array.isArray(data.models)) return false;
          // available if the server is up; note whether the model is pulled
          return true;
        })
        .catch(function () { return false; });
    }

    function hasModel() {
      return doFetch(endpoint + "/api/tags", { method: "GET" })
        .then(function (r) { return r.ok ? r.json() : { models: [] }; })
        .then(function (data) {
          var names = (data.models || []).map(function (m) { return m.name; });
          return names.indexOf(model) !== -1 || names.some(function (n) { return n.split(":")[0] === model.split(":")[0]; });
        })
        .catch(function () { return false; });
    }

    function complete(req) {
      req = req || {};
      var body = {
        model: model,
        prompt: req.prompt || "",
        system: req.system || undefined,
        stream: false,
        options: { temperature: temperature },
      };
      if (req.json) body.format = "json";
      return doFetch(endpoint + "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("Ollama HTTP " + r.status);
          return r.json();
        })
        .then(function (data) { return (data && data.response) || ""; });
    }

    // Read an NDJSON streaming response line-by-line, calling onObj per object.
    function readNDJSON(response, onObj) {
      var reader = response.body && response.body.getReader ? response.body.getReader() : null;
      if (!reader) {
        // environments without a streaming body: fall back to full text
        return Promise.resolve(response.text()).then(function (t) {
          (t || "").split("\n").forEach(function (line) {
            line = line.trim();
            if (line) { try { onObj(JSON.parse(line)); } catch (e) {} }
          });
        });
      }
      var decoder = new TextDecoder();
      var buf = "";
      function pump() {
        return reader.read().then(function (res) {
          if (res.done) {
            buf = buf.trim();
            if (buf) { try { onObj(JSON.parse(buf)); } catch (e) {} }
            return;
          }
          buf += decoder.decode(res.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop();
          lines.forEach(function (line) {
            line = line.trim();
            if (line) { try { onObj(JSON.parse(line)); } catch (e) {} }
          });
          return pump();
        });
      }
      return pump();
    }

    /** List installed model names (GET /api/tags). */
    function listModels() {
      return doFetch(endpoint + "/api/tags", { method: "GET" })
        .then(function (r) { return r.ok ? r.json() : { models: [] }; })
        .then(function (data) { return (data.models || []).map(function (m) { return m.name; }); })
        .catch(function () { return []; });
    }

    /** Streaming generate. Calls onToken(chunk, full) as tokens arrive; resolves to the full text. */
    function completeStream(req, onToken) {
      req = req || {};
      var body = {
        model: model,
        prompt: req.prompt || "",
        system: req.system || undefined,
        stream: true,
        options: { temperature: temperature },
      };
      if (req.json) body.format = "json";
      var full = "";
      return doFetch(endpoint + "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("Ollama HTTP " + r.status);
          return readNDJSON(r, function (obj) {
            if (obj.response) {
              full += obj.response;
              if (onToken) onToken(obj.response, full);
            }
          });
        })
        .then(function () { return full; });
    }

    /** Pull a model (POST /api/pull), streaming progress objects to onProgress. */
    function pull(modelName, onProgress) {
      return doFetch(endpoint + "/api/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName || model, stream: true }),
      }).then(function (r) {
        if (!r.ok) throw new Error("Ollama HTTP " + r.status);
        return readNDJSON(r, function (obj) { if (onProgress) onProgress(obj); });
      });
    }

    /**
     * Precise connection diagnosis. Returns one of:
     *   { reachable:false }                          server down / no host access
     *   { reachable:true, allowed:false }            up, but Origin not in OLLAMA_ORIGINS (403)
     *   { reachable:true, allowed:true, hasModel, models }   up and reachable
     */
    function diagnose(targetModel) {
      return doFetch(endpoint + "/api/tags", { method: "GET" })
        .then(function (r) {
          if (r.status === 403) return { reachable: true, allowed: false };
          if (!r.ok) return { reachable: true, allowed: true, httpError: r.status };
          return r.json().then(function (data) {
            var models = (data.models || []).map(function (m) { return m.name; });
            var tm = targetModel || model;
            var has =
              models.indexOf(tm) !== -1 ||
              models.some(function (n) { return n.split(":")[0] === tm.split(":")[0]; });
            return { reachable: true, allowed: true, hasModel: has, models: models };
          });
        })
        .catch(function (e) { return { reachable: false, error: String((e && e.message) || e) }; });
    }

    return {
      info: info,
      available: available,
      hasModel: hasModel,
      complete: complete,
      completeStream: completeStream,
      listModels: listModels,
      pull: pull,
      diagnose: diagnose,
    };
  }

  var api = { createOllamaProvider: createOllamaProvider };
  PW.llm = PW.llm || {};
  PW.llm.ollama = api;
  if (isNode) module.exports = api;
})();
