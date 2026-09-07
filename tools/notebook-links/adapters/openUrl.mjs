// Opens a URL (including custom schemes like `notebook://` / `omniclone://`)
// with the OS's registered handler. Shared by every adapter's `open()`.
//
// win32 deliberately uses rundll32's FileProtocolHandler rather than
// `cmd /c start`, which mangles `&` in query strings (splits the command at
// each unescaped `&`). rundll32 passes the URL through as a single argument.

import { spawn } from "node:child_process";
import process from "node:process";

export function openUrl(url) {
  if (process.platform === "win32") {
    spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}
