const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chatAPI", {
  sendMessage: (text, voiceMode) => ipcRenderer.invoke("chat-send", text, !!voiceMode),
  onChunk: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on("chat-chunk", handler);
    return () => ipcRenderer.removeListener("chat-chunk", handler);
  },
  onDone: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("chat-done", handler);
    return () => ipcRenderer.removeListener("chat-done", handler);
  },
  getConfig: () => ipcRenderer.invoke("chat-get-config"),
  saveConfig: (config) => ipcRenderer.invoke("chat-save-config", config),
  getSpeechConfig: () => ipcRenderer.invoke("chat-get-speech-config"),
  saveSpeechConfig: (config) => ipcRenderer.invoke("chat-save-speech-config", config),
  getPetName: () => ipcRenderer.invoke("chat-get-pet-name"),
  getHistory: () => ipcRenderer.invoke("chat-get-history"),
  onReloadHistory: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("chat-reload-history", handler);
    return () => ipcRenderer.removeListener("chat-reload-history", handler);
  },
  hideChat: () => ipcRenderer.send("chat-hide"),
  clearHistory: () => ipcRenderer.send("chat-clear"),
  speechToText: (audioData, sampleRate) => ipcRenderer.invoke("chat-speech-to-text", audioData, sampleRate),
  onAudio: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on("chat-audio", handler);
    return () => ipcRenderer.removeListener("chat-audio", handler);
  },
  sendAudioChunk: (data) => ipcRenderer.send("conv-audio-chunk", data),
  onConvStart: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("chat-conv-start", handler);
    return () => ipcRenderer.removeListener("chat-conv-start", handler);
  },
  onConvStop: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("chat-conv-stop", handler);
    return () => ipcRenderer.removeListener("chat-conv-stop", handler);
  },
  onConvSentence: (callback) => {
    const handler = (_, text) => callback(text);
    ipcRenderer.on("chat-conv-sentence", handler);
    return () => ipcRenderer.removeListener("chat-conv-sentence", handler);
  },
  interruptAudio: () => ipcRenderer.send("conv-interrupt"),
  onVolumeChange: (callback) => {
    const handler = (_, vol) => callback(vol);
    ipcRenderer.on("chat-volume", handler);
    return () => ipcRenderer.removeListener("chat-volume", handler);
  },
});
