// CLI-side half of the OmniClone command queue. OmniClone's data lives in
// OPFS inside its Electron renderer, which nothing outside that renderer can
// write to - so a write from this tool is a durable file dropped in
// `<appdata>/OmniClone/bridge/inbox/`, applied by the renderer whenever
// OmniClone is next running, never by this process touching OmniClone's
// data directly. See Apps/OmniClone/electron/bridgeQueue.cjs for the other
// half (the part that watches this same directory and applies commands).
//
// A loopback HTTP server in OmniClone was considered and rejected: it would
// only work while the app happens to be running, which buys nothing over a
// file queue that also works while it's closed - see DECISIONS.md.

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, renameSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { randomUUID } from "node:crypto";

function appDataDir() {
  if (process.env.APPDATA) return process.env.APPDATA;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return path.join(os.homedir(), ".local", "share");
}

export function resolveBridgeDir(envDir = process.env.LINKS_OMNICLONE_BRIDGE_DIR) {
  if (envDir && envDir.trim()) return envDir;
  // Same appdata root the snapshot lives under (Apps/OmniClone/src/
  // desktopBridge.ts / electron/main.cjs: app.getPath("userData")/bridge).
  return path.join(appDataDir(), "OmniClone", "bridge");
}

export function inboxDir(bridgeDir = resolveBridgeDir()) {
  return path.join(bridgeDir, "inbox");
}
export function resultsDir(bridgeDir = resolveBridgeDir()) {
  return path.join(bridgeDir, "results");
}
export function runtimeFilePath(bridgeDir = resolveBridgeDir()) {
  return path.join(bridgeDir, "runtime.json");
}

/** Sortable-by-creation-order id: millisecond timestamp (base36, fixed
 * width) + a short random suffix so concurrent enqueues never collide. */
export function makeCommandId(now = Date.now()) {
  const ts = now.toString(36).padStart(9, "0");
  const rand = randomUUID().replace(/-/g, "").slice(0, 8);
  return `${ts}-${rand}`;
}

function atomicWriteJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, filePath);
}

/** Reads and validates `runtime.json`; `null` if absent/unparseable. */
export function readRuntime(bridgeDir = resolveBridgeDir()) {
  try {
    const data = JSON.parse(readFileSync(runtimeFilePath(bridgeDir), "utf8"));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

/** The app counts as "live" when its heartbeat is recent - Electron main
 * rewrites `runtime.json` on an interval while running and deletes it on
 * quit, but a hard crash can leave a stale file behind, so recency (not mere
 * presence) is what this checks. */
export function isAppLive(bridgeDir = resolveBridgeDir(), staleAfterMs = 15_000) {
  const runtime = readRuntime(bridgeDir);
  if (!runtime?.heartbeat) return false;
  const age = Date.now() - new Date(runtime.heartbeat).getTime();
  return Number.isFinite(age) && age < staleAfterMs;
}

/** Writes a command envelope into the inbox. Returns the envelope written. */
export function enqueueCommand(command, params, { bridgeDir = resolveBridgeDir(), now = new Date() } = {}) {
  const id = makeCommandId(now.getTime());
  const envelope = { schema: 1, id, issuedAt: now.toISOString(), command, params };
  atomicWriteJson(path.join(inboxDir(bridgeDir), `${id}.json`), envelope);
  return envelope;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls for `results/<id>.json`, deleting it once read (so a doctor run
 * later doesn't see it as an unclaimed leftover). `null` on timeout. */
export async function waitForResult(id, { bridgeDir = resolveBridgeDir(), timeoutMs = 3000, pollIntervalMs = 100 } = {}) {
  const filePath = path.join(resultsDir(bridgeDir), `${id}.json`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (existsSync(filePath)) {
      try {
        const result = JSON.parse(readFileSync(filePath, "utf8"));
        try {
          unlinkSync(filePath);
        } catch {
          /* already gone - fine */
        }
        return result;
      } catch {
        // Caught mid-write; fall through and retry after the poll delay.
      }
    }
    if (Date.now() >= deadline) return null;
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
}

/**
 * Enqueues a command, then - only if OmniClone looks live - waits up to
 * `waitMs` for its result. Never claims "applied" without a real result:
 * when the app isn't live, or doesn't answer in time, the outcome is
 * `"queued"`, reported plainly so callers don't imply a write that hasn't
 * happened yet.
 */
export async function sendCommandAndWait(command, params, { waitMs = 3000, bridgeDir = resolveBridgeDir() } = {}) {
  const envelope = enqueueCommand(command, params, { bridgeDir });
  if (!isAppLive(bridgeDir)) {
    return { status: "queued", id: envelope.id, detail: "OmniClone is not running; command is queued for its next launch." };
  }
  const result = await waitForResult(envelope.id, { bridgeDir, timeoutMs: waitMs });
  if (!result) {
    return { status: "queued", id: envelope.id, detail: "OmniClone is running but did not respond in time; command remains queued." };
  }
  return { status: result.ok ? "applied" : "failed", id: envelope.id, result };
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Inbox files older than `staleAfterMs` with no result yet - `doctor`'s
 * "stuck command" signal (OmniClone never opened, or its watcher missed
 * them). */
export function inboxStatus({ bridgeDir = resolveBridgeDir(), staleAfterMs = 30_000 } = {}) {
  const dir = inboxDir(bridgeDir);
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.includes(".tmp-"));
  } catch {
    files = [];
  }
  const items = files.map((file) => {
    const envelope = readJsonSafe(path.join(dir, file));
    const ageMs = envelope?.issuedAt ? Date.now() - new Date(envelope.issuedAt).getTime() : null;
    return {
      file,
      id: envelope?.id ?? file.replace(/\.json$/, ""),
      command: envelope?.command ?? null,
      issuedAt: envelope?.issuedAt ?? null,
      ageMs,
      stuck: ageMs != null && ageMs > staleAfterMs,
    };
  });
  return { count: items.length, stuck: items.filter((i) => i.stuck), items };
}

/** Result files left on disk - normal operation deletes each one as soon as
 * `waitForResult` reads it, so anything still here is a leftover from a
 * timed-out wait or a command nobody ever polled for. */
export function resultsStatus({ bridgeDir = resolveBridgeDir() } = {}) {
  const dir = resultsDir(bridgeDir);
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.includes(".tmp-"));
  } catch {
    files = [];
  }
  const items = files.map((file) => {
    const result = readJsonSafe(path.join(dir, file));
    let ageMs = null;
    try {
      ageMs = Date.now() - statSync(path.join(dir, file)).mtimeMs;
    } catch {
      /* file vanished between readdir and stat - ignore */
    }
    return { file, id: result?.id ?? file.replace(/\.json$/, ""), ok: result?.ok ?? null, ageMs };
  });
  return { count: items.length, items };
}
