const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

const API_HOST = "127.0.0.1";
const API_PORT = 8799;
const DEV_URL = "http://127.0.0.1:1420";

let apiProcess = null;
let mainWindow = null;

function apiBinaryName() {
  return process.platform === "win32" ? "notebook-api.exe" : "notebook-api";
}

function getApiBinaryPath() {
  const name = apiBinaryName();

  if (app.isPackaged) {
    return path.join(process.resourcesPath, "bin", name);
  }

  return path.join(__dirname, "../../../target/release", name);
}

function getDbPath() {
  return path.join(app.getPath("userData"), "notebook.db");
}

function startApi() {
  const binary = getApiBinaryPath();

  if (!fs.existsSync(binary)) {
    throw new Error(
      `Notebook API binary not found at ${binary}. Build it with: cargo build --release -p notebook-api`
    );
  }

  const dbPath = getDbPath();
  const dbDir = path.dirname(dbPath);
  fs.mkdirSync(dbDir, { recursive: true });

  apiProcess = spawn(binary, [], {
    env: {
      ...process.env,
      NOTEBOOK_HOST: API_HOST,
      NOTEBOOK_PORT: String(API_PORT),
      NOTEBOOK_DB: dbPath,
    },
    stdio: "pipe",
    windowsHide: true,
  });

  apiProcess.on("error", (err) => {
    console.error("[notebook-api] failed to start:", err);
  });

  apiProcess.stderr?.on("data", (chunk) => {
    console.error("[notebook-api]", chunk.toString().trim());
  });

  apiProcess.stdout?.on("data", (chunk) => {
    console.log("[notebook-api]", chunk.toString().trim());
  });
}

function stopApi() {
  if (!apiProcess) return;

  apiProcess.kill();
  apiProcess = null;
}

function waitForApi(maxAttempts = 80) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const check = () => {
      const req = http.get(`http://${API_HOST}:${API_PORT}/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          retry();
        }
      });

      req.on("error", retry);
      req.setTimeout(500, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      attempts += 1;
      if (attempts >= maxAttempts) {
        reject(new Error("Notebook API did not become ready in time"));
        return;
      }
      setTimeout(check, 250);
    };

    check();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: "Notebook",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  if (app.isPackaged) {
    await mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  } else {
    await mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

async function boot() {
  startApi();
  await waitForApi();
  await createWindow();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    await boot();
  }).catch((err) => {
    console.error(err);
    app.quit();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      boot().catch((err) => {
        console.error(err);
        app.quit();
      });
    }
  });

  app.on("before-quit", stopApi);
}
