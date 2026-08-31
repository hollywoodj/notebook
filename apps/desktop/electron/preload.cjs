const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("notebookDesktop", {
  isElectron: true,
  getPathForFile: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === "function") {
        return webUtils.getPathForFile(file);
      }
    } catch (err) {
      console.error("getPathForFile failed", err);
    }
    return file && typeof file.path === "string" ? file.path : null;
  },
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  onOpenUrl: (cb) => {
    const handler = (_event, url) => cb(url);
    ipcRenderer.on("open-url", handler);
    return () => ipcRenderer.removeListener("open-url", handler);
  },
});
