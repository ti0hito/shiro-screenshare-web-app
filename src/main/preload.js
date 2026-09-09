const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Desktop Capturer ──
  getSources: (types) => ipcRenderer.invoke("get-sources", types),

  // ── Deep Link ──
  onDeepLink: (callback) => {
    ipcRenderer.on("deep-link", (_event, params) => callback(params));
  },

  // ── Window Controls ──
  minimize: () => ipcRenderer.send("window-minimize"),
  close: () => ipcRenderer.send("window-close"),

  // ── App Info ──
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  // ── Resources Path ──
  getResourcesPath: () => ipcRenderer.invoke('get-resources-path'),

  // ── Config (BACKEND_URL, LIVEKIT_URL) ──
  getConfig: () => ipcRenderer.invoke("get-config"),

  // ── Simple Audio Capture ──
  startProcessAudio: () => ipcRenderer.invoke("start-process-audio"),
  stopProcessAudio: () => ipcRenderer.invoke("stop-process-audio")
});
