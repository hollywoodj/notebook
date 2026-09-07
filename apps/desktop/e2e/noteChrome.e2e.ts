/**
 * DOM-level coverage for the note chrome added in the last clone pass.
 *
 * Unit tests prove labels and helpers. These prove a click reaches the
 * handler: Hide Sidebar actually collapses the rail, Jump To opens a
 * template, Search in this notebook scopes the dialog, and Window/Edit/View
 * items are wired. Do not click Minimize or Zoom — they resize the window
 * and the rest of the run then misses its targets.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Page } from "playwright";
import { launchApp, settle as settleApp, type LaunchedApp } from "./harness.ts";

let harness: LaunchedApp;
let page: Page;

const NEUTRAL = { x: 700, y: 500 };

async function reset(): Promise<void> {
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.mouse.click(NEUTRAL.x, NEUTRAL.y);
  await page.waitForTimeout(200);
}

const settle = () => settleApp(page);

async function openMenu(name: string): Promise<void> {
  await page.locator(".app-menu-trigger", { hasText: new RegExp(`^${name}$`) }).click();
  await page.waitForSelector(".app-menu-dropdown", { timeout: 5000 });
}

async function pickMenu(menu: string, item: RegExp): Promise<void> {
  await openMenu(menu);
  // View is tall enough that later items sit past the window edge; the
  // dropdown does not scroll, so force the click onto the real handler.
  await page.locator(".app-menu-dropdown button", { hasText: item }).click({ force: true });
}

async function menuLabels(menu: string): Promise<string[]> {
  await openMenu(menu);
  const labels = await page.locator(".app-menu-dropdown button").allTextContents();
  await reset();
  return labels.map((label) => label.replace(/\s+/g, " ").trim());
}

const rail = (label: string) =>
  page.locator(".sidebar-nav button", {
    has: page.locator(".nav-label", { hasText: new RegExp(`^${label}$`) }),
  });

before(async () => {
  harness = await launchApp();
  page = harness.page;
});

after(async () => {
  await harness?.close();
});

describe("account avatar", () => {
  it("is not on the sidebar rail", async () => {
    await settle();
    assert.equal(await page.locator(".account-chip").count(), 0);
    assert.equal(await page.locator(".account-popover").count(), 0);
  });
});

describe("sidebar hide/show", () => {
  it("collapses the rail from the note chrome and brings it back", async () => {
    await reset();
    await page.getByTitle("Hide Sidebar").click();
    await page.waitForFunction(
      () => document.querySelector(".app-shell")?.classList.contains("sidebar-collapsed"),
      null,
      { timeout: 5000 }
    );
    assert.equal(await page.locator(".sidebar-nav").isVisible(), false);

    await page.getByTitle("Show Sidebar").click();
    await page.waitForFunction(
      () => !document.querySelector(".app-shell")?.classList.contains("sidebar-collapsed"),
      null,
      { timeout: 5000 }
    );
    await page.waitForSelector(".sidebar-nav", { state: "visible", timeout: 5000 });
  });

  it("offers New stack and Hide Sidebar in the more menu, and New stack opens a prompt", async () => {
    await reset();
    await page.getByTitle("More actions").click();
    await page.waitForSelector(".sidebar-more-menu", { timeout: 5000 });
    const items = await page.locator(".sidebar-more-menu [role='menuitem']").allTextContents();
    assert.equal(items.includes("New stack"), true, `more menu items: ${items.join(", ")}`);
    assert.equal(items.includes("Hide Sidebar"), true, `more menu items: ${items.join(", ")}`);

    await page.locator(".sidebar-more-menu [role='menuitem']", { hasText: /^New stack$/ }).click();
    await page.waitForSelector(".modal h3", { timeout: 5000 });
    assert.equal(await page.locator(".modal h3").innerText(), "New stack");
    await page.locator(".modal-actions button", { hasText: /^Cancel$/ }).click();
    await page.waitForSelector(".modal", { state: "detached", timeout: 5000 });
  });

  it("hides the sidebar from the more menu", async () => {
    await reset();
    await page.getByTitle("More actions").click();
    await page.waitForSelector(".sidebar-more-menu", { timeout: 5000 });
    await page.locator(".sidebar-more-menu [role='menuitem']", { hasText: /^Hide Sidebar$/ }).click();
    await page.waitForFunction(
      () => document.querySelector(".app-shell")?.classList.contains("sidebar-collapsed"),
      null,
      { timeout: 5000 }
    );
    await page.getByTitle("Show Sidebar").click();
    await page.waitForSelector(".sidebar-nav", { state: "visible", timeout: 5000 });
  });
});

describe("Window, View, and Edit menus", () => {
  it("lists Minimize, Zoom, and Keep on Top, and can toggle keep-on-top", async () => {
    await reset();
    const labels = await menuLabels("Window");
    assert.equal(
      labels.some((label) => label.startsWith("Minimize")),
      true,
      `Window menu: ${labels.join(" | ")}`
    );
    assert.equal(labels.some((label) => label.startsWith("Zoom")), true);
    assert.equal(labels.some((label) => label.includes("Keep on Top")), true);

    await pickMenu("Window", /^Keep on Top$/);
    const kept = await menuLabels("Window");
    assert.equal(
      kept.some((label) => label.includes("Don't Keep on Top")),
      true,
      `after Keep on Top: ${kept.join(" | ")}`
    );
    await pickMenu("Window", /Don't Keep on Top/);
  });

  it("hides and shows the status bar once a note is open", async () => {
    await reset();
    await page.getByTitle("New note").click();
    await page.waitForSelector(".title-input", { timeout: 10_000 });
    await page.waitForSelector(".editor-status", { timeout: 5000 });

    await pickMenu("View", /^Hide Status Bar$/);
    await page.waitForSelector(".editor-status", { state: "detached", timeout: 5000 });

    await pickMenu("View", /^Show Status Bar$/);
    await page.waitForSelector(".editor-status", { timeout: 5000 });
  });

  it("toggles spell check on the editor", async () => {
    await reset();
    await page.waitForSelector(".note-editor-content", { timeout: 5000 });
    assert.equal(await page.locator(".note-editor-content").getAttribute("spellcheck"), "true");

    await pickMenu("Edit", /^Disable Spell Check$/);
    await page.waitForFunction(
      () =>
        document.querySelector(".note-editor-content")?.getAttribute("spellcheck") === "false",
      null,
      { timeout: 5000 }
    );

    await pickMenu("Edit", /^Enable Spell Check$/);
    await page.waitForFunction(
      () => document.querySelector(".note-editor-content")?.getAttribute("spellcheck") === "true",
      null,
      { timeout: 5000 }
    );
  });
});

describe("Jump To and notebook search", () => {
  it("finds a built-in template from Jump To", async () => {
    await reset();
    // Ctrl/⌘ J — the View item's label includes a shortcut suffix, so the
    // keybinding is the stable way to open the dialog.
    await page.keyboard.press("Control+j");
    await page.waitForSelector(".jump-dialog", { timeout: 5000 });
    const placeholder = await page.locator(".jump-search input").getAttribute("placeholder");
    assert.match(placeholder ?? "", /template/i);

    await page.locator(".jump-search input").fill("Meeting notes");
    const templateHit = page.locator(".jump-item", {
      has: page.locator(".jump-kind", { hasText: /^template$/ }),
    });
    await templateHit.first().waitFor({ timeout: 5000 });
    await templateHit.first().click();
    await page.waitForSelector(".jump-dialog", { state: "detached", timeout: 5000 });
    await page.waitForFunction(
      () => document.querySelector(".panel-header h2")?.textContent === "Templates",
      null,
      { timeout: 5000 }
    );
  });

  it("opens Search in this notebook from the list header", async () => {
    await reset();
    await settle();
    await rail("Notebooks").click();
    await page.waitForSelector(".sidebar-flyout", { timeout: 5000 });
    await page
      .locator(".sidebar-flyout .nav-item", { hasText: "First Notebook" })
      .click();
    await page.waitForFunction(
      () => document.querySelector(".panel-header h2")?.textContent === "First Notebook",
      null,
      { timeout: 5000 }
    );

    await page.getByRole("button", { name: "Search in this notebook" }).click();
    await page.waitForSelector(".search-dialog", { timeout: 5000 });
    assert.match(await page.locator(".search-scope-chip").innerText(), /First Notebook/);
    await page.keyboard.press("Escape");
    await page.waitForSelector(".search-dialog", { state: "detached", timeout: 5000 });
  });
});
