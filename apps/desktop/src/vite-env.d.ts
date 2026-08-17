/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface NotebookDesktopBridge {
  isElectron: boolean;
  getPathForFile?: (file: File) => string | null;
}

interface Window {
  notebookDesktop?: NotebookDesktopBridge;
}
