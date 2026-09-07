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
  windowControl?: (
    action: "minimize" | "maximize" | "alwaysOnTop" | "setAlwaysOnTop" | "clearAlwaysOnTop"
  ) => Promise<{ alwaysOnTop: boolean; maximized: boolean } | null>;
  onOpenUrl?: (cb: (url: string) => void) => () => void;
}

interface Window {
  notebookDesktop?: NotebookDesktopBridge;
}
