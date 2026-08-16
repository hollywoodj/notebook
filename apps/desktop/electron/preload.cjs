const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("notebookDesktop", {
  isElectron: true,
});
