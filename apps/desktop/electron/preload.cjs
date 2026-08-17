const { contextBridge, webUtils } = require("electron");

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
});
