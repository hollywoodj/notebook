// OmniClone adapter: reads the snapshot file OmniClone's Electron main
// process writes on every library change (see
// Apps/OmniClone/src/bridgeSnapshot.ts + hooks/usePersistedLibrary.ts).
//
// OmniClone's real data lives in OPFS (wa-sqlite VFS pool format) inside the
// renderer, which nothing outside the renderer - including this tool - can
// read or write. The snapshot is the only bridge, so a missing or stale
// snapshot is an expected, normal state here, never a crash.

import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { formatRef } from "../refs.mjs";
import { openUrl } from "./openUrl.mjs";

function appDataDir() {
  if (process.env.APPDATA) return process.env.APPDATA;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return path.join(os.homedir(), ".local", "share");
}

export function defaultSnapshotPath() {
  return path.join(appDataDir(), "OmniClone", "bridge", "snapshot.json");
}

export function resolveSnapshotPath(envPath = process.env.LINKS_OMNICLONE_SNAPSHOT) {
  return envPath && envPath.trim() ? envPath : defaultSnapshotPath();
}

/** Reads and validates the snapshot; `null` for anything short of a usable
 * `{ projects: [...] }` shape - missing file, bad JSON, or wrong shape are
 * all the same "not available" state to callers. */
export function readSnapshot(snapshotPath = resolveSnapshotPath()) {
  let raw;
  try {
    raw = readFileSync(snapshotPath, "utf8");
  } catch {
    return null;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.projects)) return null;
  return data;
}

function projectRef(id) {
  return { app: "omniclone", kind: "project", id };
}

function projectUrl(id) {
  return `omniclone://project/${id}`;
}

function subtitleFor(project) {
  const parts = [];
  if (project.folder) parts.push(project.folder);
  if (project.status) parts.push(project.status);
  return parts.join(" · ") || null;
}

/** @type {import("./index.mjs").Adapter} */
export const omnicloneAdapter = {
  app: "omniclone",
  kinds: ["project"],

  async resolve(ref) {
    if (ref.kind !== "project") {
      throw new Error(`omniclone adapter does not know kind "${ref.kind}" (known: project).`);
    }
    const snapshot = readSnapshot();
    if (!snapshot) {
      // Distinct from `false`: we simply don't know, since there is no
      // snapshot to check against.
      return { ref: formatRef(ref), title: null, subtitle: null, url: projectUrl(ref.id), exists: null };
    }
    const project = snapshot.projects.find((p) => p.id === ref.id);
    if (!project) {
      return { ref: formatRef(ref), title: null, subtitle: null, url: projectUrl(ref.id), exists: false };
    }
    return {
      ref: formatRef(ref),
      title: project.name,
      subtitle: subtitleFor(project),
      url: projectUrl(ref.id),
      exists: true,
    };
  },

  async list(kind, { query, limit = 20 } = {}) {
    if (kind !== "project") {
      throw new Error(`omniclone adapter does not know kind "${kind}" (known: project).`);
    }
    const snapshot = readSnapshot();
    if (!snapshot) return [];
    const needle = query?.trim().toLowerCase();
    const matches = needle
      ? snapshot.projects.filter((p) => p.name?.toLowerCase().includes(needle))
      : snapshot.projects;
    return matches.slice(0, limit).map((project) => ({
      ref: formatRef(projectRef(project.id)),
      title: project.name,
      subtitle: subtitleFor(project),
      url: projectUrl(project.id),
      exists: true,
    }));
  },

  async open(ref) {
    openUrl(projectUrl(ref.id));
  },

  async health() {
    const snapshotPath = resolveSnapshotPath();
    const snapshot = readSnapshot(snapshotPath);
    if (!snapshot) {
      return {
        ok: false,
        transport: "snapshot",
        detail: "snapshot not found — open OmniClone once to generate it",
        exportedAt: null,
        snapshotPath,
      };
    }
    return {
      ok: true,
      transport: "snapshot",
      detail: snapshotPath,
      exportedAt: snapshot.exportedAt ?? null,
      snapshotPath,
    };
  },
};
