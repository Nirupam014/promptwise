#!/usr/bin/env node
"use strict";
/**
 * build-firefox.js — produce a Firefox-loadable copy of the browser extension.
 *
 * Firefox MV3 uses an event-page `background.scripts` (no service worker) and
 * has no offscreen API (so WebLLM is Chrome-only; Ollama works). This copies
 * the extension into dist-firefox/ and swaps in manifest.firefox.json as the
 * manifest.json Firefox expects.
 *
 *   node scripts/build-firefox.js
 *   then: Firefox → about:debugging → This Firefox → Load Temporary Add-on
 *         → pick packages/browser-extension/dist-firefox/manifest.json
 */
const fs = require("fs");
const path = require("path");

const ext = path.resolve(__dirname, "..", "packages", "browser-extension");
const out = path.join(ext, "dist-firefox");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(ext, "src"), path.join(out, "src"), { recursive: true });
fs.cpSync(path.join(ext, "vendor"), path.join(out, "vendor"), { recursive: true });
fs.cpSync(path.join(ext, "icons"), path.join(out, "icons"), { recursive: true });
fs.copyFileSync(path.join(ext, "manifest.firefox.json"), path.join(out, "manifest.json"));

console.log("Built Firefox extension → " + path.relative(process.cwd(), out));
console.log("Load it: Firefox → about:debugging#/runtime/this-firefox → Load Temporary Add-on → select dist-firefox/manifest.json");
