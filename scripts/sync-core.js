#!/usr/bin/env node
"use strict";
/**
 * sync-core.js — keep the extensions' vendored copies of the engine in sync
 * with packages/core/src.
 *
 *   node scripts/sync-core.js          copy the engine into each vendor/core
 *   node scripts/sync-core.js --check  fail (exit 1) if any copy is stale (CI)
 *
 * The browser and VS Code extensions must be standalone (loadable unpacked /
 * packaged), so they ship a copy of the engine rather than importing it.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "packages", "core", "src");

const MODULES = [
  "tokens", "text", "protect", "memory", "persona", "brevity", "summarize", "modelfit", "rewrite", "flood", "engine",
  "llm/provider", "llm/tasks", "llm/ollama", "llm/webllm", "llm/chromeai",
];

const TARGETS = [
  { dir: "packages/browser-extension/vendor/core", files: MODULES },
  { dir: "packages/vscode-extension/vendor/core", files: MODULES.concat(["index"]) },
];

const check = process.argv.includes("--check");
let drift = 0;
let copied = 0;

for (const target of TARGETS) {
  const outDir = path.join(root, target.dir);
  if (!check) fs.mkdirSync(outDir, { recursive: true });
  for (const name of target.files) {
    const src = fs.readFileSync(path.join(srcDir, name + ".js"), "utf8");
    const dest = path.join(outDir, name + ".js");
    if (!check) fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (check) {
      const cur = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;
      if (cur !== src) {
        drift++;
        console.error("out of sync: " + path.relative(root, dest));
      }
    } else {
      fs.writeFileSync(dest, src);
      copied++;
    }
  }
}

if (check) {
  if (drift) {
    console.error("\n" + drift + " vendored file(s) out of sync. Run: npm run sync-core");
    process.exit(1);
  }
  console.log("Vendored core is in sync with packages/core/src.");
} else {
  console.log("Synced " + copied + " files into " + TARGETS.length + " vendor folder(s).");
}
