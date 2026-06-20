"use strict";
/**
 * PromptWise desktop companion — Electron main process.
 *
 * A menu-bar/tray app. Press the global hotkey (⌘⇧Space / Ctrl+Shift+Space) to
 * pop a small always-on-top optimizer: it pulls your clipboard in, optimizes the
 * prompt (heuristic + optional local Ollama), and copies the result back so you
 * paste it into the Claude / ChatGPT / Gemini desktop app — no integration into
 * those closed apps required.
 *
 * All engine work happens here in the Node main process; the renderer is just UI
 * talking over a locked-down preload bridge.
 */
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, clipboard, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

let PW;
try {
  PW = require("@promptwise-dev/core");
} catch (_) {
  PW = require("../core/src/index.js"); // run from a clone without install
}

const SETTINGS_FILE = path.join(app.getPath("userData"), "promptwise-settings.json");
const DEFAULTS = {
  llm: { backend: "off", endpoint: "http://localhost:11434", model: "llama3.2:3b" },
  outputBudget: { enabled: false, words: 120 },
  memory: [],
};

function loadSettings() {
  try {
    return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")));
  } catch (_) {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}
function saveSettings(s) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
  } catch (_) {}
}

let win = null;
let tray = null;

function createWindow() {
  win = new BrowserWindow({
    width: 600,
    height: 420,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("blur", function () {
    if (win && !win.webContents.isDevToolsOpened()) win.hide();
  });
}

function toggleWindow() {
  if (!win) createWindow();
  if (win.isVisible()) {
    win.hide();
    return;
  }
  win.webContents.send("pw:show", { clipboard: clipboard.readText() });
  win.show();
  win.focus();
}

function buildEngine() {
  const s = loadSettings();
  const mem = new PW.Memory(s.memory || []);
  let provider = null;
  if (s.llm && s.llm.backend === "ollama") {
    provider = PW.createOllamaProvider({ endpoint: s.llm.endpoint, model: s.llm.model });
  }
  const budget = s.outputBudget && s.outputBudget.enabled ? { words: s.outputBudget.words || 120, noPreamble: true } : null;
  return new PW.PromptWise({ memory: mem, provider: provider, outputBudget: budget });
}

// ---- IPC ----
ipcMain.handle("pw:optimize", async function (e, args) {
  args = args || {};
  const pw = buildEngine();
  const input = { prompt: args.prompt || "", signals: { surface: "desktop", hostApp: args.target || "desktop" } };
  if (args.useLlm && pw.provider) {
    return pw.optimizeWithLLMStream(input, function (tok) { try { e.sender.send("pw:token", tok); } catch (_) {} });
  }
  return pw.optimize(input);
});

ipcMain.handle("pw:copy", function (e, text) { clipboard.writeText(text || ""); return true; });
ipcMain.handle("pw:hide", function () { if (win) win.hide(); return true; });
ipcMain.handle("pw:getSettings", function () { return loadSettings(); });
ipcMain.handle("pw:setSettings", function (e, s) { saveSettings(s); return true; });
ipcMain.handle("pw:status", async function () {
  const s = loadSettings();
  if (!s.llm || s.llm.backend !== "ollama") return { backend: "off" };
  const p = PW.createOllamaProvider({ endpoint: s.llm.endpoint, model: s.llm.model });
  const d = await p.diagnose(s.llm.model);
  return Object.assign({ backend: "ollama", model: s.llm.model }, d);
});

function makeTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png"));
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("PromptWise");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Optimize a prompt   (⌘⇧Space)", click: toggleWindow },
      { type: "separator" },
      { label: "Quit PromptWise", click: function () { app.quit(); } },
    ])
  );
  tray.on("click", toggleWindow);
}

app.whenReady().then(function () {
  createWindow();
  makeTray();
  globalShortcut.register("CommandOrControl+Shift+Space", toggleWindow);
  if (process.platform === "darwin" && app.dock) app.dock.hide(); // menu-bar app, no dock icon
});

app.on("window-all-closed", function (e) { /* keep running in the tray */ });
app.on("will-quit", function () { globalShortcut.unregisterAll(); });
