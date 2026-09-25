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

describe("Evernote formatting toolbar", () => {
  async function openEditableNote(): Promise<void> {
    await reset();
    await page.getByTitle("New note").click();
    await page.waitForSelector(".title-input", { timeout: 10_000 });
    await page.locator(".ProseMirror").click();
    await page.waitForSelector(".editor-toolbar.is-visible", { timeout: 5000 });
  }

  it("shows Insert, Undo, Redo, and More instead of a kitchen-sink row", async () => {
    await openEditableNote();
    assert.equal(await page.getByTitle("Insert").count(), 1);
    assert.equal(await page.getByTitle("Undo").count(), 1);
    assert.equal(await page.getByTitle("Redo").count(), 1);
    assert.equal(await page.getByTitle("More formatting").count(), 1);
    assert.equal(await page.getByTitle("Large header").count(), 0);
    assert.equal(await page.getByTitle("Strikethrough").count(), 0);
  });

  it("keeps the text-style menu above note content and applies a header", async () => {
    await openEditableNote();
    await page.keyboard.type("Heading");
    await page.keyboard.press("Control+a");
    await page.getByTitle("Text style").click();

    const largeHeader = page.locator('.style-menu-item[data-style="h1"]');
    await largeHeader.waitFor({ state: "visible" });
    const box = await largeHeader.boundingBox();
    assert.ok(box);
    const menuIsTopmost = await page.evaluate(
      ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".style-menu")),
      { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    );
    assert.equal(menuIsTopmost, true);

    await largeHeader.click();
    assert.equal(await page.locator(".ProseMirror h1").innerText(), "Heading");
  });

  it("keeps the formatting toolbar beside the note color rail", async () => {
    await openEditableNote();
    // Colors now live behind a single trigger in the note breadcrumb bar
    // instead of an always-visible row of dots.
    await page.getByTitle("Note colour").click();
    await page.getByTitle("Orange", { exact: true }).click();
    await page.waitForSelector(".editor-body.note-color-orange");

    const rail = await page.evaluate(() => {
      const body = document.querySelector(".editor-body")?.getBoundingClientRect();
      const toolbarElement = document.querySelector(".editor-toolbar");
      const toolbar = toolbarElement?.getBoundingClientRect();
      if (!body || !toolbar || !toolbarElement) throw new Error("Editor body or toolbar is missing");
      const accent = getComputedStyle(toolbarElement, "::before");
      return {
        offset: toolbar.left - body.left,
        width: accent.width,
        color: accent.backgroundColor,
      };
    });

    assert.ok(Math.abs(rail.offset) < 0.1, `toolbar offset was ${rail.offset}px`);
    assert.equal(rail.width, "4px");
    assert.equal(rail.color, "rgb(247, 144, 9)");
  });

  it("lists Checkbox in Insert and Strikethrough in More", async () => {
    await openEditableNote();
    await page.getByTitle("Insert").click();
    await page.waitForSelector(".insert-menu", { timeout: 5000 });
    const insert = (await page.locator(".insert-menu button").allTextContents()).map((label) =>
      label.trim()
    );
    assert.equal(insert.includes("Checkbox"), true, `Insert: ${insert.join(", ")}`);
    assert.equal(insert.includes("Table"), true);
    assert.equal(insert.includes("Divider"), true);

    await page.getByTitle("More formatting").click();
    await page.waitForSelector(".toolbar-overflow-menu", { timeout: 5000 });
    const more = (await page.locator(".toolbar-overflow-menu button").allTextContents()).map(
      (label) => label.trim()
    );
    assert.equal(more.includes("Strikethrough"), true, `More: ${more.join(", ")}`);
    assert.equal(more.includes("Remove formatting"), true);
    assert.equal(more.includes("Align left"), true);
  });

  it("opens the slash insert menu and inserts a table", async () => {
    await openEditableNote();
    await page.locator(".ProseMirror").click();
    await page.keyboard.type("/");
    await page.waitForSelector(".slash-insert-menu", { timeout: 5000 });
    await page.keyboard.type("tab");
    const items = (await page.locator(".slash-insert-menu button").allTextContents()).map((label) =>
      label.trim()
    );
    assert.equal(items.includes("Table"), true, `slash: ${items.join(", ")}`);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".slash-insert-menu", { state: "detached", timeout: 5000 });
    await page.waitForSelector(".ProseMirror table", { timeout: 5000 });
  });

  it("inserts a checkbox from the Insert menu", async () => {
    await openEditableNote();
    await page.getByTitle("Insert").click();
    await page.waitForSelector(".insert-menu", { timeout: 5000 });
    await page.locator(".insert-menu button", { hasText: /^Checkbox$/ }).click();
    await page.waitForSelector(".ProseMirror input[data-inline-checkbox]", { timeout: 5000 });
  });

  it("shows a floating format bar when text is selected", async () => {
    await openEditableNote();
    await page.locator(".ProseMirror").click();
    await page.keyboard.type("Hello");
    await page.keyboard.press("Control+a");
    await page.waitForSelector(".selection-toolbar", { timeout: 5000 });
    assert.equal(await page.locator(".selection-toolbar").getByTitle("Bold").count(), 1);
    assert.equal(await page.locator(".selection-toolbar").getByTitle("Highlight").count(), 1);
  });

  it("offers Print and Note history in the note ⋯ menu", async () => {
    await openEditableNote();
    await page.getByTitle("More", { exact: true }).click();
    await page.waitForSelector(".menu-popover.right", { timeout: 5000 });
    const items = (await page.locator(".menu-popover.right button").allTextContents()).map((label) =>
      label.trim()
    );
    assert.equal(items.includes("Print…"), true, `note menu: ${items.join(", ")}`);
    assert.equal(items.includes("Note history"), true);
  });
  it("activates formatting buttons from the keyboard", async () => {
    await openEditableNote();
    await page.keyboard.type("Keyboard formatting");
    await page.keyboard.press("Control+a");
    const bold = page.locator(".editor-toolbar").getByRole("button", { name: "Bold", exact: true });
    await bold.focus();
    await bold.press("Enter");
    assert.equal(await page.locator(".ProseMirror strong").innerText(), "Keyboard formatting");
  });

  it("keeps font, size, and color controls working in a narrow toolbar", async () => {
    await openEditableNote();
    await page.keyboard.type("Overflow formatting");
    await page.keyboard.press("Control+a");
    await page.locator(".editor-toolbar").evaluate((el) => { (el as HTMLElement).style.width = "280px"; });
    try {
      await page.getByTitle("More formatting").click();
      const menu = page.locator(".toolbar-overflow-menu");
      await menu.getByLabel("Font", { exact: true }).selectOption({ index: 1 });
      await menu.getByLabel("Font size", { exact: true }).selectOption("24");
      await menu.getByLabel("Text color", { exact: true }).selectOption({ index: 2 });
      const style = await page.locator(".ProseMirror span[style]").first().getAttribute("style");
      assert.match(style || "", /font-family:/);
      assert.match(style || "", /font-size: 24px/);
      assert.match(style || "", /color:/);
    } finally {
      await page.locator(".editor-toolbar").evaluate((el) => { (el as HTMLElement).style.width = ""; });
    }
  });

  it("does not offer slash inserts inside code blocks", async () => {
    await openEditableNote();
    await page.getByTitle("Insert").click();
    await page.locator(".insert-menu").getByRole("button", { name: "Code block", exact: true }).click();
    await page.keyboard.type("/tmp");
    assert.equal(await page.locator(".slash-insert-menu").count(), 0);
    assert.match(await page.locator(".ProseMirror pre").innerText(), /\/tmp/);
  });

  it("dismisses the note context menu when clicking outside, including editor controls", async () => {
    await openEditableNote();
    await page.keyboard.type("Context menu dismissal");
    const editor = page.locator(".ProseMirror");
    const menu = page.locator(".context-menu");
    await editor.click({ button: "right" });
    await menu.waitFor({ state: "visible" });
    await page.locator(".editor-toolbar").getByRole("button", { name: "Bold", exact: true }).click();
    await menu.waitFor({ state: "detached" });

    await editor.click({ button: "right" });
    await menu.waitFor({ state: "visible" });
    await editor.click({ position: { x: 5, y: 5 } });
    await menu.waitFor({ state: "detached" });

    await editor.click({ button: "right" });
    await menu.waitFor({ state: "visible" });
    await menu.getByRole("menuitem", { name: "Bulleted list", exact: true }).click();
    await menu.waitFor({ state: "detached" });
    assert.equal(await editor.locator("ul li").innerText(), "Context menu dismissal");
  });

  it("does not format a locked note through keyboard commands", async () => {
    await openEditableNote();
    await page.keyboard.type("Locked content");
    await page.keyboard.press("Control+a");
    await page.getByTitle("Lock note", { exact: true }).click();
    try {
      await page.waitForSelector(".ProseMirror[contenteditable=false]");
      const before = await page.locator(".ProseMirror").innerHTML();
      await page.keyboard.press("Control+b");
      assert.equal(await page.locator(".ProseMirror").innerHTML(), before);
      assert.equal(await page.locator(".editor-toolbar.is-visible").count(), 0);
      await page.locator(".ProseMirror").click({ button: "right" });
      assert.equal(await page.getByRole("menuitem", { name: "Bold", exact: true }).isDisabled(), true);
      await page.keyboard.press("Escape");
    } finally {
      await page.getByTitle("Unlock note", { exact: true }).click();
    }
  });
  it("keeps inline checkboxes disabled while the note is locked", async () => {
    await openEditableNote();
    await page.getByTitle("Insert").click();
    await page.locator(".insert-menu").getByRole("button", { name: "Checkbox", exact: true }).click();
    await page.getByTitle("Lock note", { exact: true }).click();
    try {
      assert.equal(await page.locator(".ProseMirror input[data-inline-checkbox]").isDisabled(), true);
      assert.equal(await page.locator(".ProseMirror input[data-inline-checkbox]").isChecked(), false);
    } finally {
      await page.getByTitle("Unlock note", { exact: true }).click();
    }
    assert.equal(await page.locator(".ProseMirror input[data-inline-checkbox]").isDisabled(), false);
  });
});
