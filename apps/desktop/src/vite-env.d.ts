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
  openExternal?: (url: string) => Promise<void>;
  onOpenUrl?: (cb: (url: string) => void) => () => void;
}

interface Window {
  notebookDesktop?: NotebookDesktopBridge;
}
