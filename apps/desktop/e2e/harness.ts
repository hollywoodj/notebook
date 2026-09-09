/**
 * Launches the real Electron app for DOM-level tests.
 *
 * The unit suite under `src/` proves the state machines; nothing proved the
 * wiring - which handler is on which element, whether a real `mouseleave`
 * reaches the close timer, whether a menu item is connected to the command it
 * claims. That is what these tests are for. Everything here runs against the
 * app as shipped, so keep it to behaviour a user could observe.
 *
 * Four environment traps cost an afternoon each the first time; all four are
 * handled below, and none of them announce themselves when they go wrong:
 *
 * 1. Vite must answer on `127.0.0.1`, because `electron/main.cjs` hardcodes
 *    `DEV_URL` there. `vite.config.ts` now sets `host` to match - without it
 *    Vite binds `localhost` only, `127.0.0.1` refuses, and Electron opens a
 *    blank window with no error.
 * 2. `ELECTRON_RUN_AS_NODE` is inherited from a VS Code extension host. With
 *    it set, `require("electron")` returns a path string and the app dies on
 *    `requestSingleInstanceLock`. It is deleted from the child env below.
 * 3. In dev the app spawns `target/release/notebook-api.exe` - the RELEASE
 *    binary. `cargo build --workspace` builds debug, so a stale release build
 *    means the tests silently verify an old backend. `preflight` fails loudly
 *    instead, and reports the binary's age.
 * 4. The database path comes from `app.getPath("userData")` and ignores env
 *    overrides, so every run gets a throwaway `--user-data-dir`. Without it
 *    these tests open the real ~881MB notebook.
 *
 * The app's menu bar is DOM, not native (`main.cjs` calls
 * `Menu.setApplicationMenu(null)`), so drive it by clicking `.app-menu-trigger`
 * and `.app-menu-dropdown` rather than through Playwright's menu APIs.
 */
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

export const DEV_URL = "http://127.0.0.1:1420";

const apiBinary = path.join(
  repoRoot,
  "target/release",
  process.platform === "win32" ? "notebook-api.exe" : "notebook-api"
);

function preflight(): void {
  if (!existsSync(apiBinary)) {
    throw new Error(
      `The dev app spawns the RELEASE api binary, which is missing:\n  ${apiBinary}\n` +
        `Build it first:  cargo build --release -p notebook-api`
    );
  }
  const ageHours = (Date.now() - statSync(apiBinary).mtimeMs) / 3_600_000;
  if (ageHours > 24) {
    console.warn(
      `note: ${path.basename(apiBinary)} is ${Math.round(ageHours)}h old. ` +
        `If you changed Rust since, rerun: cargo build --release -p notebook-api`
    );
  }
}

async function serverIsUp(): Promise<boolean> {
  try {
    const response = await fetch(DEV_URL, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Reuses a dev server you already have running, otherwise starts one and
 * takes responsibility for stopping it. */
async function ensureViteServer(): Promise<ChildProcess | null> {
  if (await serverIsUp()) return null;

  // Spawn Vite's entry with this Node rather than the .bin shim, which needs a
  // shell on Windows and then cannot be killed cleanly.
  const child = spawn(process.execPath, [path.join(packageRoot, "node_modules/vite/bin/vite.js")], {
    cwd: packageRoot,
    stdio: "ignore",
    env: process.env,
  });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await serverIsUp()) return child;
    if (child.exitCode !== null) {
      throw new Error(`Vite exited with code ${child.exitCode} before serving ${DEV_URL}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`Vite did not answer on ${DEV_URL} within 60s`);
}

/** Waits until the parts of the DOM these tests touch stop changing shape.
 * The app exposes no loading flag, so sample its structure until three
 * readings in a row agree. */
export async function settle(page: Page): Promise<void> {
  let previous = "";
  let stable = 0;
  for (let attempt = 0; attempt < 60; attempt++) {
    const signature = await page.evaluate(() =>
      [
        document.querySelectorAll(".sidebar-nav button").length,
        document.querySelectorAll(".note-card").length,
        document.querySelector(".note-list")?.childElementCount ?? -1,
      ].join(":")
    );
    stable = signature === previous ? stable + 1 : 0;
    if (stable >= 2) return;
    previous = signature;
    await page.waitForTimeout(100);
  }
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  close: () => Promise<void>;
}

export async function launchApp(): Promise<LaunchedApp> {
  preflight();
  // A different backend answering /health would silently connect these tests
  // to its database, even though Electron has a throwaway user-data directory.
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error("Notebook API port 8799 is occupied. Close Notebook and any dev API before running e2e tests; refusing to use an existing database.")));
    probe.listen(8799, "127.0.0.1", () => probe.close((error) => error ? reject(error) : resolve()));
  });
  const vite = await ensureViteServer();

  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "notebook-e2e-"));
  // Built by hand rather than spread-and-delete: Playwright wants every value
  // defined, and dropping ELECTRON_RUN_AS_NODE here means it can never be
  // copied across in the first place.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") env[key] = value;
  }

  const app = await electron.launch({
    args: [".", `--user-data-dir=${userDataDir}`],
    cwd: packageRoot,
    env,
  });

  const page = await app.firstWindow();
  await page.waitForSelector(".sidebar-nav", { timeout: 60_000 });
  // The first paint lands before the api has answered, and the re-render when
  // it does lands replaces nav buttons. If that happens under the pointer, the
  // browser fires mouseleave on the removed node and the new one gets no
  // mouseenter until the mouse moves again - which silently cancels a hover a
  // test just performed. Wait for the app to stop changing shape first.
  await settle(page);

  return {
    app,
    page,
    async close() {
      await app.close();
      vite?.kill();
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // Windows keeps a handle on the db briefly after exit; the temp dir
        // is disposable either way.
      }
    },
  };
}
