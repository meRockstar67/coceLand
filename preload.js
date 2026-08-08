const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("coceland", {
  install: () => ipcRenderer.invoke("install"),
  play: () => ipcRenderer.invoke("play"),
  login: () => ipcRenderer.invoke("login"),
  loginOffline: (name) => ipcRenderer.invoke("login-offline", name),
  logout: () => ipcRenderer.invoke("logout"),
  getAccount: () => ipcRenderer.invoke("get-account"),
  checkStatus: () => ipcRenderer.invoke("check-status"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  closeGame: () => ipcRenderer.invoke("close-game"),
  getInstallDir: () => ipcRenderer.invoke("get-install-dir"),
  chooseInstallDir: () => ipcRenderer.invoke("choose-install-dir"),
  getRam: () => ipcRenderer.invoke("get-ram"),
  setRam: (gb) => ipcRenderer.invoke("set-ram", gb),

  onProgress: (callback) => ipcRenderer.on("progress", (_event, data) => callback(data)),
  onUpdateReady: (callback) => ipcRenderer.on("update-ready", () => callback()),
  onGameClosed: (callback) => ipcRenderer.on("game-closed", () => callback()),
  onLog: (callback) => ipcRenderer.on("log", (_event, msg) => callback(msg)),
});
