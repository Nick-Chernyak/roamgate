import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld(
  "roamgateDesktop",
  Object.freeze({
    showWindow: () => ipcRenderer.send("desktop:show"),
    retry: () => ipcRenderer.send("desktop:retry"),
    openLogs: () => ipcRenderer.send("desktop:logs"),
  }),
);
