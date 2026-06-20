"use strict";
/**
 * Locked-down bridge between the renderer (UI) and the main process (engine).
 * Renderer has no Node access; it can only call these whitelisted methods.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pw", {
  optimize: function (args) { return ipcRenderer.invoke("pw:optimize", args); },
  copy: function (text) { return ipcRenderer.invoke("pw:copy", text); },
  hide: function () { return ipcRenderer.invoke("pw:hide"); },
  getSettings: function () { return ipcRenderer.invoke("pw:getSettings"); },
  setSettings: function (s) { return ipcRenderer.invoke("pw:setSettings", s); },
  status: function () { return ipcRenderer.invoke("pw:status"); },
  onToken: function (cb) { ipcRenderer.on("pw:token", function (e, t) { cb(t); }); },
  onShow: function (cb) { ipcRenderer.on("pw:show", function (e, d) { cb(d); }); },
});
