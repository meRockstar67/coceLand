const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("coceland", {
  launch: () => ipcRenderer.invoke("launch"),
  onLog: (callback) => ipcRenderer.on("log", (_event, msg) => callback(msg)),
  onUpdateReady: (callback) => ipcRenderer.on("update-ready", () => callback()),
  installUpdate: () => ipcRenderer.invoke("install-update"),
});
