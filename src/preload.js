const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getPets: () => ipcRenderer.invoke("get-pets"),
  getActiveSlug: () => ipcRenderer.invoke("get-active-slug"),
  setActivePet: (slug) => ipcRenderer.invoke("set-active-pet", slug),
  moveWindow: (dx, dy) => ipcRenderer.invoke("move-window", dx, dy),
  showContextMenu: (pets, activeSlug) => ipcRenderer.invoke("show-context-menu", pets, activeSlug),
  getState: () => ipcRenderer.invoke("get-state"),
  getBubble: () => ipcRenderer.invoke("get-bubble"),
  toggleChat: () => ipcRenderer.invoke("toggle-chat"),
  sendAudioChunk: (data) => ipcRenderer.send("conv-audio-chunk", data),
  onConvStart: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("pet-conv-start", handler);
    return () => ipcRenderer.removeListener("pet-conv-start", handler);
  },
  onConvStop: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("pet-conv-stop", handler);
    return () => ipcRenderer.removeListener("pet-conv-stop", handler);
  },
});
