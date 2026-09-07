// Parses and formats refs of the form `<app>://<kind>/<id>`. Both notebook
// (`notebook://note/{id}`, see apps/desktop/src/omniFocus.ts / ui/share.ts)
// and OmniClone (`omniclone://task/{id}`, `omniclone:///task/{id}`, see
// src/links.ts) already speak this vocabulary; this module is the shared
// grammar for the link-storage tool, not a new scheme.
//
// Both apps sometimes emit the three-slash form (`app:///kind/id`) - OmniClone
// always does for `taskUrl()`. This module accepts either and always
// canonicalizes to two slashes on output, so stored/printed refs are stable
// regardless of which form a caller pasted in.
//
// Adding a new kind (or a whole new app) is a one-line change to the
// `REGISTRY` below - see README.md's "how to add a third app" section.

/**
 * @typedef {{ app: string, kind: string, id: string }} Ref
 */

/** app -> Set of known kinds. One line per app; one entry per kind. */
const REGISTRY = {
  notebook: new Set(["note"]),
  omniclone: new Set(["project"]),
};

function knownApps() {
  return Object.keys(REGISTRY).sort();
}

function knownKinds(app) {
  return [...(REGISTRY[app] ?? [])].sort();
}

/**
 * Parses `<app>://<kind>/<id>` or `<app>:///<kind>/<id>` into a {@link Ref}.
 * Throws with a message naming every known app (unknown app) or every known
 * kind for that app (unknown kind) - never a bare "invalid ref".
 *
 * @param {string} raw
 * @returns {Ref}
 */
export function parseRef(raw) {
  const value = String(raw ?? "").trim();
  const match = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/\/?([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(
      `"${value}" is not a ref of the form <app>://<kind>/<id>. Known apps: ${knownApps().join(", ")}.`
    );
  }
  const [, app, kind, idRaw] = match;
  if (!(app in REGISTRY)) {
    throw new Error(`Unknown app "${app}" in ref "${value}". Known apps: ${knownApps().join(", ")}.`);
  }
  if (!REGISTRY[app].has(kind)) {
    throw new Error(
      `Unknown kind "${kind}" for app "${app}" in ref "${value}". Known kinds for ${app}: ${knownKinds(app).join(", ")}.`
    );
  }
  let id;
  try {
    id = decodeURIComponent(idRaw).trim();
  } catch {
    id = idRaw.trim();
  }
  if (!id) {
    throw new Error(`Ref "${value}" has an empty id.`);
  }
  return { app, kind, id };
}

/**
 * Formats a {@link Ref} back to canonical two-slash form: `app://kind/id`.
 * @param {Ref} ref
 * @returns {string}
 */
export function formatRef(ref) {
  return `${ref.app}://${ref.kind}/${encodeURIComponent(ref.id)}`;
}

/** Parses, then immediately re-formats - the normalize-to-canonical helper
 * callers reach for instead of `formatRef(parseRef(raw))` everywhere. */
export function normalizeRef(raw) {
  return formatRef(parseRef(raw));
}

/** True if `raw` parses as a ref at all (any known app/kind), false
 * otherwise - never throws. */
export function isRef(raw) {
  try {
    parseRef(raw);
    return true;
  } catch {
    return false;
  }
}

export function listKnownApps() {
  return knownApps();
}

export function listKnownKinds(app) {
  return knownKinds(app);
}
