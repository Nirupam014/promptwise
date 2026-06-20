/**
 * protect.js — mask spans that must survive rewriting untouched.
 *
 * The rewrite engine compresses prose, but some spans are load-bearing and
 * must be preserved verbatim: fenced code blocks, inline code, and URLs. We
 * replace them with opaque placeholders before transforming, then restore.
 */
(function () {
  var isNode = typeof module !== "undefined" && module.exports;
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var PW = (root.PromptWiseCore = root.PromptWiseCore || {});

  function protect(text) {
    var store = [];
    var i = 0;
    function mask(s) {
      var key = "PW" + i++ + "";
      store.push([key, s]);
      return key;
    }
    var out = (text || "")
      .replace(/```[\s\S]*?```/g, function (m) { return mask(m); }) // fenced code
      .replace(/`[^`\n]+`/g, function (m) { return mask(m); })       // inline code
      .replace(/https?:\/\/[^\s)]+/g, function (m) { return mask(m); }); // URLs

    function restore(t) {
      var r = t;
      // restore in reverse so nested placeholders resolve correctly
      for (var k = store.length - 1; k >= 0; k--) {
        r = r.split(store[k][0]).join(store[k][1]);
      }
      return r;
    }
    return { text: out, restore: restore, count: store.length };
  }

  var api = { protect: protect };
  PW.protect = api;
  if (isNode) module.exports = api;
})();
