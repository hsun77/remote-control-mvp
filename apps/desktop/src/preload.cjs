const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("remoteDesktop", {
  listSources: () => ipcRenderer.invoke("desktop:list-sources"),
  displayInfo: () => ipcRenderer.invoke("desktop:display-info"),
  sendNativeInput: (event) => ipcRenderer.invoke("native-input:send", event)
});
