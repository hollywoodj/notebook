import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import {
  enqueueCommand,
  waitForResult,
  isAppLive,
  readRuntime,
  inboxStatus,
  resultsStatus,
  inboxDir,
  resultsDir,
  runtimeFilePath,
} from "../omnicloneQueue.mjs";
import { makeTempDir, cleanupTempDir } from "./helpers.mjs";

function withBridgeDir(fn) {
  const dir = makeTempDir("notebook-links-bridge-");
  return Promise.resolve(fn(dir)).finally(() => cleanupTempDir(dir));
}

test("enqueueCommand writes a versioned envelope with a sortable id", async () => {
  await withBridgeDir((bridgeDir) => {
    const envelope = enqueueCommand("setProjectLinkBlock", { projectId: "p1", block: "hello" }, { bridgeDir });
    assert.equal(envelope.schema, 1);
    assert.equal(envelope.command, "setProjectLinkBlock");
    assert.deepEqual(envelope.params, { projectId: "p1", block: "hello" });
    assert.ok(envelope.id);
    assert.ok(envelope.issuedAt);

    const filePath = path.join(inboxDir(bridgeDir), `${envelope.id}.json`);
    assert.ok(existsSync(filePath));
    const onDisk = JSON.parse(readFileSync(filePath, "utf8"));
    assert.deepEqual(onDisk, envelope);
  });
});

test("command ids are sortable by issue order", async () => {
  await withBridgeDir((bridgeDir) => {
    const a = enqueueCommand("setProjectLinkBlock", {}, { bridgeDir, now: new Date(1000) });
    const b = enqueueCommand("setProjectLinkBlock", {}, { bridgeDir, now: new Date(2000) });
    assert.ok(a.id < b.id, "an earlier command's id must sort before a later one's");
  });
});

test("waitForResult reads and deletes the result file exactly once (at-most-once consumption)", async () => {
  await withBridgeDir(async (bridgeDir) => {
    const envelope = enqueueCommand("setProjectLinkBlock", { projectId: "p1", block: null }, { bridgeDir });
    const resultFile = path.join(resultsDir(bridgeDir), `${envelope.id}.json`);
    mkdirSync(resultsDir(bridgeDir), { recursive: true });
    writeFileSync(resultFile, JSON.stringify({ id: envelope.id, ok: true, appliedAt: new Date().toISOString() }));

    const result = await waitForResult(envelope.id, { bridgeDir, timeoutMs: 500, pollIntervalMs: 10 });
    assert.equal(result.ok, true);
    assert.equal(existsSync(resultFile), false, "result file must be consumed (deleted) after being read");
  });
});

test("waitForResult times out and returns null when no result ever appears", async () => {
  await withBridgeDir(async (bridgeDir) => {
    const result = await waitForResult("never-going-to-exist", { bridgeDir, timeoutMs: 150, pollIntervalMs: 20 });
    assert.equal(result, null);
  });
});

test("waitForResult picks up a result that appears slightly after polling starts", async () => {
  await withBridgeDir(async (bridgeDir) => {
    const envelope = enqueueCommand("setProjectLinkBlock", {}, { bridgeDir });
    setTimeout(() => {
      mkdirSync(resultsDir(bridgeDir), { recursive: true });
      writeFileSync(
        path.join(resultsDir(bridgeDir), `${envelope.id}.json`),
        JSON.stringify({ id: envelope.id, ok: true, appliedAt: new Date().toISOString() })
      );
    }, 50);
    const result = await waitForResult(envelope.id, { bridgeDir, timeoutMs: 1000, pollIntervalMs: 20 });
    assert.equal(result.ok, true);
  });
});

test("isAppLive is false with no runtime.json, true with a recent heartbeat, false once it's stale", async () => {
  await withBridgeDir((bridgeDir) => {
    assert.equal(isAppLive(bridgeDir), false);

    mkdirSync(bridgeDir, { recursive: true });
    writeFileSync(
      runtimeFilePath(bridgeDir),
      JSON.stringify({ pid: 1234, startedAt: new Date().toISOString(), heartbeat: new Date().toISOString() })
    );
    assert.equal(isAppLive(bridgeDir), true);
    assert.equal(readRuntime(bridgeDir).pid, 1234);

    writeFileSync(
      runtimeFilePath(bridgeDir),
      JSON.stringify({ pid: 1234, startedAt: new Date(0).toISOString(), heartbeat: new Date(0).toISOString() })
    );
    assert.equal(isAppLive(bridgeDir), false);
  });
});

test("inboxStatus flags old envelopes as stuck", async () => {
  await withBridgeDir((bridgeDir) => {
    enqueueCommand("setProjectLinkBlock", {}, { bridgeDir, now: new Date() });
    enqueueCommand("setProjectLinkBlock", {}, { bridgeDir, now: new Date(Date.now() - 60_000) });
    const status = inboxStatus({ bridgeDir, staleAfterMs: 30_000 });
    assert.equal(status.count, 2);
    assert.equal(status.stuck.length, 1);
  });
});

test("resultsStatus reports any leftover (unclaimed) result files", async () => {
  await withBridgeDir((bridgeDir) => {
    mkdirSync(resultsDir(bridgeDir), { recursive: true });
    writeFileSync(path.join(resultsDir(bridgeDir), "abc.json"), JSON.stringify({ id: "abc", ok: false }));
    const status = resultsStatus({ bridgeDir });
    assert.equal(status.count, 1);
    assert.equal(status.items[0].ok, false);
  });
});
