// Adapter registry. Every app notebook-links knows how to resolve/list/open
// links against gets one entry here - see README.md's "how to add a third
// app" section for the steps to add another.

/**
 * @typedef {Object} Entity
 * @property {string} ref - canonical `app://kind/id` string.
 * @property {string|null} title
 * @property {string|null} subtitle
 * @property {string} url - app-openable URL (may differ in slash count from `ref`).
 * @property {boolean|null} exists - `null` means "unknown" (e.g. no snapshot
 *   to check against yet), distinct from a confirmed `false`.
 */

/**
 * @typedef {Object} Health
 * @property {boolean} ok
 * @property {string} transport - e.g. "http", "sqlite", "snapshot", "none".
 * @property {string} detail
 */

/**
 * @typedef {Object} Adapter
 * @property {string} app - matches a key in refs.mjs's REGISTRY.
 * @property {string[]} kinds - kinds this adapter knows how to handle.
 * @property {(ref: {app: string, kind: string, id: string}) => Promise<Entity|null>} resolve
 * @property {(kind: string, opts?: {query?: string, limit?: number}) => Promise<Entity[]>} list
 * @property {(ref: {app: string, kind: string, id: string}) => Promise<void>} open
 * @property {() => Promise<Health>} health
 */

import { notebookAdapter } from "./notebook.mjs";
import { omnicloneAdapter } from "./omniclone.mjs";

/** app name -> Adapter. Add a new app by adding one entry here (and one
 * entry in refs.mjs's REGISTRY for its kinds). */
export const ADAPTERS = {
  notebook: notebookAdapter,
  omniclone: omnicloneAdapter,
};

/** Looks up the adapter for `app`, throwing a clear error naming every known
 * app if there isn't one - adapters and refs.mjs's REGISTRY should always
 * agree on the set of known apps. */
export function getAdapter(app) {
  const adapter = ADAPTERS[app];
  if (!adapter) {
    throw new Error(`No adapter registered for app "${app}". Known apps: ${Object.keys(ADAPTERS).join(", ")}.`);
  }
  return adapter;
}

export function listAdapters() {
  return Object.values(ADAPTERS);
}
