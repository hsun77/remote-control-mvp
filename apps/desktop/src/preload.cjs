const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("remoteDesktop", {
  deviceId: () => ipcRenderer.invoke("desktop:device-id"),
  listSources: () => ipcRenderer.invoke("desktop:list-sources"),
  displayInfo: () => ipcRenderer.invoke("desktop:display-info"),
  screenPermission: () => ipcRenderer.invoke("desktop:screen-permission"),
  nativeInputStatus: () => ipcRenderer.invoke("native-input:status"),
  sendNativeInput: (event) => ipcRenderer.invoke("native-input:send", event)
});
