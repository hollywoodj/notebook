#!/usr/bin/env node
// notebook-links CLI: link.add/rm/ls, resolve, list, open, doctor.
// Zero dependencies - hand-rolled argv parsing and text tables, matching
// tools/notebook-mcp's zero-dep style. See README.md for full docs.

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { formatRef, parseRef, listKnownApps, listKnownKinds } from "./refs.mjs";
import { openStore, resolveStoreDbPath } from "./store.mjs";
import { getAdapter, listAdapters } from "./adapters/index.mjs";
import { materializeEdge, materializeRef } from "./materialize.mjs";
import { getNoteContent } from "./notebookWrite.mjs";
import { readSnapshot } from "./adapters/omniclone.mjs";
import { isAppLive, inboxStatus, resultsStatus, resolveBridgeDir } from "./omnicloneQueue.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// ---------------------------------------------------------------------------
// argv parsing
// ---------------------------------------------------------------------------

const BOOLEAN_FLAGS = new Set(["json", "help", "version", "no-materialize"]);

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h") {
      flags.help = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
        continue;
      }
      const name = arg.slice(2);
      if (BOOLEAN_FLAGS.has(name)) {
        flags[name] = true;
      } else {
        flags[name] = argv[++i];
      }
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags };
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function printTable(rows, columns) {
  if (!rows.length) return "(none)";
  const widths = columns.map((col) =>
    Math.max(col.label.length, ...rows.map((row) => String(row[col.key] ?? "").length))
  );
  const line = (cells) => cells.map((cell, i) => String(cell ?? "").padEnd(widths[i])).join("  ").trimEnd();
  const out = [line(columns.map((c) => c.label))];
  out.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) out.push(line(columns.map((c) => row[c.key])));
  return out.join("\n");
}

const USAGE = `notebook-links - link tool bridging notebook and OmniClone refs

Usage:
  notebook-links link add <refA> <refB> [--rel related] [--note TEXT] [--no-materialize] [--wait MS]
  notebook-links link rm  <refA> [refB] [--rel R] [--no-materialize] [--wait MS]
  notebook-links link ls  [ref] [--app APP] [--limit N]
  notebook-links resolve  <ref>
  notebook-links list <app> <kind> [--query Q] [--limit N]
  notebook-links open <ref>
  notebook-links sync [ref] [--wait MS]
  notebook-links doctor

Global flags:
  --json        emit structured JSON instead of aligned text
  --db PATH     link store database path (else LINKS_DB env var, else the default appdata path)
  --help        show this help
  --version     show the version

Materialization flags (link add/rm/sync):
  --no-materialize  update the broker only; skip writing the visible link block into either note
  --wait MS         how long to wait for OmniClone to apply a queued write (default 3000ms);
                     only meaningful when OmniClone isn't open, since it always applies instantly when it is

Ref grammar: <app>://<kind>/<id> (three-slash form app:///kind/id also accepted).
Known apps: ${listKnownApps().join(", ")}

Writes to OmniClone are queued, not immediate: OmniClone's data lives in a
place only its own renderer can write to, so this tool drops a command file
and OmniClone applies it next time it's running. If it's open right now, the
wait above makes that indistinguishable from instant; if it's closed, the
result is reported as "queued", never as if it already happened.
`;

// ---------------------------------------------------------------------------
// Ref/entity resolution helpers shared by several commands
// ---------------------------------------------------------------------------

async function resolveRef(refRaw) {
  const ref = parseRef(refRaw);
  const adapter = getAdapter(ref.app);
  const entity = await adapter.resolve(ref);
  return { ref, adapter, entity };
}

function refApp(refString) {
  try {
    return parseRef(refString).app;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function materializeFlagOpts(flags) {
  return { waitMs: flags.wait ? Number(flags.wait) : undefined };
}

function describeMaterialization(results) {
  return results.map((r) => {
    if (r.skipped) return `  ${r.ref}: skipped (${r.reason})`;
    if (r.error) return `  ${r.ref}: error (${r.error})`;
    if (r.queue) return `  ${r.ref}: ${r.queue.status} (${r.queue.detail ?? r.queue.status})`;
    return `  ${r.ref}: ${r.changed ? "updated" : "already up to date"}`;
  });
}

async function cmdLinkAdd(store, positionals, flags) {
  const [refARaw, refBRaw] = positionals;
  if (!refARaw || !refBRaw) {
    throw new UsageError("link add requires two refs: notebook-links link add <refA> <refB>");
  }
  const rel = flags.rel || "related";
  const note = flags.note;
  const result = store.add(refARaw, refBRaw, { rel, note });
  const a = formatRef(parseRef(refARaw));
  const b = formatRef(parseRef(refBRaw));
  const lines = [result.created ? `Linked ${a} <-> ${b} (${rel}).` : `Already linked ${a} <-> ${b} (${rel}).`];
  let materialized;
  if (!flags["no-materialize"]) {
    materialized = await materializeEdge(store, refARaw, refBRaw, materializeFlagOpts(flags));
    lines.push("Materialized:", ...describeMaterialization(materialized));
  }
  return { exitCode: 0, json: { ...result, refA: a, refB: b, rel, materialized }, lines };
}

async function cmdLinkRm(store, positionals, flags) {
  const [refARaw, refBRaw] = positionals;
  if (!refARaw) {
    throw new UsageError("link rm requires at least one ref: notebook-links link rm <refA> [refB]");
  }
  // Capture who refA was linked to *before* removing, so an omitted refB
  // (remove every edge touching refA) still knows every note that needs its
  // block regenerated - after removal the broker no longer knows.
  const touchedRefs = refBRaw
    ? [refBRaw]
    : store.list(refARaw).map((edge) => edge.other);

  const result = store.remove(refARaw, refBRaw, { rel: flags.rel });
  const a = formatRef(parseRef(refARaw));
  const desc = refBRaw ? `${a} <-> ${formatRef(parseRef(refBRaw))}` : `every edge touching ${a}`;
  const lines = [`Removed ${result.removed} edge(s) (${desc}).`];

  let materialized;
  if (!flags["no-materialize"] && result.removed > 0) {
    const opts = materializeFlagOpts(flags);
    const refsToSync = [refARaw, ...touchedRefs];
    materialized = [];
    for (const ref of refsToSync) {
      try {
        materialized.push({ ref: formatRef(parseRef(ref)), ...(await materializeRef(store, ref, opts)) });
      } catch (err) {
        materialized.push({ ref, changed: false, error: err.message });
      }
    }
    lines.push("Materialized:", ...describeMaterialization(materialized));
  }

  return {
    exitCode: 0,
    json: { ...result, refA: a, refB: refBRaw ? formatRef(parseRef(refBRaw)) : null, materialized },
    lines,
  };
}

async function cmdSync(store, positionals, flags) {
  const refRaw = positionals[0];
  const opts = materializeFlagOpts(flags);
  let refs;
  if (refRaw) {
    refs = [formatRef(parseRef(refRaw))];
  } else {
    const seen = new Set();
    for (const link of store.all()) {
      seen.add(link.src);
      seen.add(link.dst);
    }
    refs = [...seen];
  }
  const results = [];
  for (const ref of refs) {
    try {
      results.push({ ref, ...(await materializeRef(store, ref, opts)) });
    } catch (err) {
      results.push({ ref, changed: false, error: err.message });
    }
  }
  const lines = refs.length ? describeMaterialization(results) : ["(no linked refs to sync)"];
  return { exitCode: 0, json: results, lines };
}

async function cmdLinkLs(store, positionals, flags) {
  const refRaw = positionals[0];
  const limit = flags.limit ? Number(flags.limit) : undefined;
  const appFilter = flags.app;

  /** @type {{ refA: string, refB: string, rel: string, note: string|null, createdAt: string }[]} */
  let rows;
  if (refRaw) {
    const ref = parseRef(refRaw);
    const a = formatRef(ref);
    rows = store.list(refRaw, { limit }).map((edge) => ({
      refA: a,
      refB: edge.other,
      rel: edge.rel,
      note: edge.note,
      createdAt: edge.createdAt,
    }));
  } else {
    let all = store.all();
    if (appFilter) all = all.filter((l) => refApp(l.src) === appFilter || refApp(l.dst) === appFilter);
    if (limit) all = all.slice(0, limit);
    rows = all.map((l) => ({ refA: l.src, refB: l.dst, rel: l.rel, note: l.note, createdAt: l.createdAt }));
  }

  const cache = new Map();
  async function resolveCached(refString) {
    if (cache.has(refString)) return cache.get(refString);
    const promise = (async () => {
      try {
        const parsed = parseRef(refString);
        const adapter = getAdapter(parsed.app);
        return await adapter.resolve(parsed);
      } catch (err) {
        return { ref: refString, title: null, subtitle: null, url: null, exists: false, error: err.message };
      }
    })();
    cache.set(refString, promise);
    return promise;
  }

  const enriched = [];
  for (const row of rows) {
    const [a, b] = await Promise.all([resolveCached(row.refA), resolveCached(row.refB)]);
    enriched.push({
      ...row,
      titleA: a.title,
      titleB: b.title,
      danglingA: a.exists === false,
      danglingB: b.exists === false,
    });
  }

  const lines = printTable(
    enriched.map((e) => ({
      refA: e.danglingA ? `${e.refA} (dangling)` : e.refA,
      titleA: e.titleA ?? "",
      rel: e.rel,
      refB: e.danglingB ? `${e.refB} (dangling)` : e.refB,
      titleB: e.titleB ?? "",
      note: e.note ?? "",
    })),
    [
      { key: "refA", label: "REF A" },
      { key: "titleA", label: "TITLE A" },
      { key: "rel", label: "REL" },
      { key: "refB", label: "REF B" },
      { key: "titleB", label: "TITLE B" },
      { key: "note", label: "NOTE" },
    ]
  );

  return { exitCode: 0, json: enriched, lines: [lines] };
}

async function cmdResolve(positionals) {
  const [refRaw] = positionals;
  if (!refRaw) throw new UsageError("resolve requires a ref: notebook-links resolve <ref>");
  const { entity } = await resolveRef(refRaw);
  const existsLabel = entity.exists === null ? "unknown" : entity.exists ? "yes" : "no";
  const lines = [
    `ref:      ${entity.ref}`,
    `title:    ${entity.title ?? "(none)"}`,
    `subtitle: ${entity.subtitle ?? "(none)"}`,
    `url:      ${entity.url ?? "(none)"}`,
    `exists:   ${existsLabel}`,
  ];
  return { exitCode: entity.exists === false ? 2 : 0, json: entity, lines };
}

async function cmdList(positionals, flags) {
  const [app, kind] = positionals;
  if (!app || !kind) throw new UsageError("list requires an app and a kind: notebook-links list <app> <kind>");
  if (!listKnownApps().includes(app)) {
    throw new UsageError(`Unknown app "${app}". Known apps: ${listKnownApps().join(", ")}.`);
  }
  if (!listKnownKinds(app).includes(kind)) {
    throw new UsageError(`Unknown kind "${kind}" for app "${app}". Known kinds: ${listKnownKinds(app).join(", ")}.`);
  }
  const adapter = getAdapter(app);
  const limit = flags.limit ? Number(flags.limit) : undefined;
  const entities = await adapter.list(kind, { query: flags.query, limit });
  const lines = printTable(
    entities.map((e) => ({ ref: e.ref, title: e.title ?? "", subtitle: e.subtitle ?? "" })),
    [
      { key: "ref", label: "REF" },
      { key: "title", label: "TITLE" },
      { key: "subtitle", label: "SUBTITLE" },
    ]
  );
  return { exitCode: 0, json: entities, lines: [lines] };
}

async function cmdOpen(positionals) {
  const [refRaw] = positionals;
  if (!refRaw) throw new UsageError("open requires a ref: notebook-links open <ref>");
  const { ref, adapter, entity } = await resolveRef(refRaw);
  if (entity.exists === false) {
    return { exitCode: 2, json: entity, lines: [`${entity.ref} does not exist - not opening.`] };
  }
  await adapter.open(ref);
  return { exitCode: 0, json: { opened: entity.ref, url: entity.url }, lines: [`Opened ${entity.ref} (${entity.url}).`] };
}

function formatAge(iso) {
  if (!iso) return "unknown";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const ms = Date.now() - then;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function cmdDoctor(store) {
  const lines = [];
  const json = { store: { path: store.path, linkCount: store.count(), schemaVersion: store.schemaVersion() }, adapters: [] };
  lines.push(`Store: ${store.path} (${json.store.linkCount} link(s), schema v${json.store.schemaVersion})`);

  for (const adapter of listAdapters()) {
    const health = await adapter.health();
    json.adapters.push({ app: adapter.app, ...health });
    lines.push(`Adapter ${adapter.app}: ${health.ok ? "ok" : "not ok"} (transport=${health.transport}) - ${health.detail}`);
    if ("exportedAt" in health) {
      lines.push(`  snapshot exportedAt: ${health.exportedAt ?? "(none)"} (${formatAge(health.exportedAt)})`);
    }
  }

  const all = store.all();
  const dangling = [];
  for (const link of all) {
    for (const side of [link.src, link.dst]) {
      try {
        const parsed = parseRef(side);
        const adapter = getAdapter(parsed.app);
        const entity = await adapter.resolve(parsed);
        if (entity.exists === false) dangling.push({ link, ref: side });
      } catch (err) {
        dangling.push({ link, ref: side, error: err.message });
      }
    }
  }
  json.dangling = dangling;
  lines.push(`Dangling link endpoints: ${dangling.length}`);
  for (const d of dangling) {
    lines.push(`  - ${d.ref} (edge ${d.link.src} <-> ${d.link.dst}, rel ${d.link.rel})`);
  }

  // --- OmniClone command queue ---------------------------------------------
  const bridgeDir = resolveBridgeDir();
  const live = isAppLive(bridgeDir);
  const inbox = inboxStatus({ bridgeDir });
  const results = resultsStatus({ bridgeDir });
  json.omnicloneQueue = { bridgeDir, live, inbox, results };
  lines.push(`OmniClone: ${live ? "running (heartbeat recent)" : "not running (no recent heartbeat)"}`);
  lines.push(`  Queue depth (inbox): ${inbox.count}${inbox.stuck.length ? ` (${inbox.stuck.length} stuck)` : ""}`);
  for (const item of inbox.stuck) {
    lines.push(`    - ${item.file}: ${item.command ?? "(unreadable)"}, issued ${formatAge(item.issuedAt)}`);
  }
  lines.push(`  Unclaimed result files: ${results.count}`);
  for (const item of results.items) {
    lines.push(`    - ${item.file}: ok=${item.ok}`);
  }

  // --- Materialization drift: broker says linked, but the note's block
  // doesn't mention the other side. Best-effort substring check against raw
  // content, not a strict block parse - good enough for a diagnostic. -----
  const drift = [];
  const notebookContentCache = new Map();
  const omnicloneSnapshot = readSnapshot();
  for (const link of all) {
    for (const [sideRaw, otherRaw] of [[link.src, link.dst], [link.dst, link.src]]) {
      let side, other;
      try {
        side = parseRef(sideRaw);
        other = parseRef(otherRaw);
      } catch {
        continue;
      }
      let present = null; // null = could not verify
      if (side.app === "notebook" && side.kind === "note") {
        if (!notebookContentCache.has(side.id)) {
          notebookContentCache.set(side.id, await getNoteContent(side.id).catch(() => null));
        }
        const note = notebookContentCache.get(side.id);
        if (note) present = note.content.includes(other.id) || note.content.includes(formatRef(other));
      } else if (side.app === "omniclone" && side.kind === "project") {
        const project = omnicloneSnapshot?.projects?.find((p) => p.id === side.id);
        if (project) present = (project.note ?? "").includes(other.id) || (project.note ?? "").includes(formatRef(other));
      }
      if (present === false) drift.push({ ref: sideRaw, missing: otherRaw, rel: link.rel });
    }
  }
  json.materializationDrift = drift;
  lines.push(`Materialization drift: ${drift.length}`);
  for (const d of drift) {
    lines.push(`  - ${d.ref} does not mention ${d.missing} (rel ${d.rel})`);
  }

  return { exitCode: 0, json, lines };
}

// ---------------------------------------------------------------------------
// Errors / main
// ---------------------------------------------------------------------------

class UsageError extends Error {}

async function main(argv) {
  const { positionals, flags } = parseArgs(argv);

  if (flags.version) {
    console.log(readVersion());
    return 0;
  }
  if (flags.help || positionals.length === 0) {
    console.log(USAGE);
    return 0;
  }

  const [command, sub, ...rest] = positionals;

  let result;
  if (command === "link") {
    if (!["add", "rm", "ls"].includes(sub)) {
      throw new UsageError('link requires a subcommand: "add", "rm", or "ls".');
    }
    const store = openStore(resolveStoreDbPath(flags.db));
    try {
      if (sub === "add") result = await cmdLinkAdd(store, rest, flags);
      else if (sub === "rm") result = await cmdLinkRm(store, rest, flags);
      else result = await cmdLinkLs(store, rest, flags);
    } finally {
      store.close();
    }
  } else if (command === "resolve") {
    result = await cmdResolve([sub, ...rest]);
  } else if (command === "list") {
    result = await cmdList([sub, ...rest], flags);
  } else if (command === "open") {
    result = await cmdOpen([sub, ...rest]);
  } else if (command === "sync") {
    const store = openStore(resolveStoreDbPath(flags.db));
    try {
      result = await cmdSync(store, [sub, ...rest].filter((v) => v !== undefined), flags);
    } finally {
      store.close();
    }
  } else if (command === "doctor") {
    const store = openStore(resolveStoreDbPath(flags.db));
    try {
      result = await cmdDoctor(store);
    } finally {
      store.close();
    }
  } else {
    throw new UsageError(`Unknown command "${command}".\n\n${USAGE}`);
  }

  if (flags.json) {
    console.log(JSON.stringify(result.json, null, 2));
  } else {
    console.log(result.lines.join("\n"));
  }
  return result.exitCode ?? 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    if (err instanceof UsageError) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    console.error(`Error: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
