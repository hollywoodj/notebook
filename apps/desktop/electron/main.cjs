const { app, BrowserWindow, Menu, ipcMain, shell, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

const API_HOST = "127.0.0.1";
const API_PORT = 8799;
const DEV_URL = "http://127.0.0.1:1420";
const APP_NAME = "Notebook";
const RESTART_ARG = "--restart-app";
// A dev run launches electron.exe directly, so without an explicit icon
// Windows would show the stock Electron icon instead of Notebook's own.
const APP_ICON = path.join(__dirname, "..", "build", process.platform === "win32" ? "icon.ico" : "icon.png");

let apiProcess = null;
let mainWindow = null;
let restartingApp = false;
let pendingOpenUrl =
  process.argv.find((item) => String(item).startsWith("notebook:")) ?? null;

function restartApp() {
  if (restartingApp) return;
  restartingApp = true;
  // Without this, the relaunched process starts before this one has actually released the
  // single-instance lock, so its own requestSingleInstanceLock() fails and it quits itself -
  // the app just closes instead of restarting.
  app.releaseSingleInstanceLock();
  // Goes through the shared launcher instead of app.relaunch(), which would just re-exec
  // whatever was last built - this way restart rebuilds from source first.
  // Dev/CLAUDE.md: "Every app rebuilds when it starts" / "Restart lives on the icon menu".
  spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', 'C:\\Users\\James\\Dev\\Scripts\\launch-app.ps1', '-App', 'Notebook',
  ], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  app.quit();
}

/**
 * The "Restart Notebook" entry in the taskbar jump list. It launches a throwaway second
 * instance carrying RESTART_ARG; the running instance sees it in `second-instance` and restarts
 * itself.
 *
 * Explorer runs jump list tasks from its own working directory, not the project folder, so the
 * app path passed to electron.exe must be absolute - a relative one resolves against Explorer's
 * directory, finds nothing, and dies silently before the running instance ever hears about it.
 * A task that cannot work announces itself instead of pretending to succeed.
 */
function installRestartTask() {
  if (process.platform !== "win32") return;
  const appPath = app.getAppPath();
  if (!app.isPackaged && !path.isAbsolute(appPath)) {
    console.error(`${APP_NAME}: not registering the restart task - the app path is not absolute (${appPath})`);
    return;
  }
  const args = app.isPackaged ? [RESTART_ARG] : [appPath, RESTART_ARG];
  const workingDirectory = app.isPackaged ? path.dirname(process.execPath) : appPath;
  const registered = app.setUserTasks([{ program: process.execPath, arguments: args.map((arg) => `"${arg}"`).join(" "),
    workingDirectory,
    ...(!app.isPackaged && fs.existsSync(APP_ICON)
      ? { iconPath: APP_ICON, iconIndex: 0 }
      : { iconPath: process.execPath, iconIndex: 0 }),
    title: `Restart ${APP_NAME}`,
    description: `Restart ${APP_NAME} to load the latest build` }]);
  if (!registered) console.error(`${APP_NAME}: Windows rejected the restart task registration`);
}

function sendOpenUrl(url) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("open-url", url);
  } else {
    pendingOpenUrl = url;
  }
}

function isAllowedExternalUrl(url) {
  return /^(https?:|mailto:|omniclone:|omnifocus:|notebook:)/i.test(String(url || ""));
}

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
    backgroundColor: "#ffffff",
    ...(fs.existsSync(APP_ICON) ? { icon: APP_ICON } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.setMenuBarVisibility(false);
    mainWindow.removeMenu();
    mainWindow.show();
    if (pendingOpenUrl) {
      sendOpenUrl(pendingOpenUrl);
      pendingOpenUrl = null;
    }
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
  app.on("second-instance", (_event, argv) => {
    if (argv.includes(RESTART_ARG)) {
      restartApp();
      return;
    }
    const url = argv.find((item) => String(item).startsWith("notebook:"));
    if (url) sendOpenUrl(url);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    sendOpenUrl(url);
  });

  ipcMain.handle("open-external", async (_event, url) => {
    if (!isAllowedExternalUrl(url)) {
      throw new Error("Blocked external URL");
    }
    await shell.openExternal(String(url));
  });

  ipcMain.handle("window-control", async (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    switch (String(action)) {
      case "minimize":
        win.minimize();
        break;
      case "maximize":
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
        break;
      case "alwaysOnTop":
        win.setAlwaysOnTop(!win.isAlwaysOnTop());
        break;
      case "setAlwaysOnTop":
        win.setAlwaysOnTop(true);
        break;
      case "clearAlwaysOnTop":
        win.setAlwaysOnTop(false);
        break;
      default:
        break;
    }
    return {
      alwaysOnTop: win.isAlwaysOnTop(),
      maximized: win.isMaximized(),
    };
  });

  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("notebook", process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient("notebook");
  }

  app.whenReady().then(async () => {
    // Ties windows to this app's own taskbar/Start Menu identity instead of
    // Electron's, which is what makes the explicit icon above take effect.
    app.setAppUserModelId("app.notebook.desktop");
    installRestartTask();
    // Notebook is light-mode-only; without this, the native window chrome
    // (title bar) still follows the OS dark/light setting even though the
    // in-app UI is hardcoded to light.
    nativeTheme.themeSource = "light";
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
