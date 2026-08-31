/**
 * DOM-level coverage for the sidebar flyout.
 *
 * `src/sidebarFlyout.test.ts` proves the state machine against a fake clock.
 * These tests prove the parts it cannot reach: that the handlers are attached
 * to the elements a user actually touches, that a real `mouseleave` arms the
 * real 180ms timer, and that the View menu items are wired to the commands
 * they claim to be.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Page } from "playwright";
import { launchApp, settle as settleApp, type LaunchedApp } from "./harness.ts";

let harness: LaunchedApp;
let page: Page;

/** Somewhere with no flyout handlers on it, for parking the pointer. */
const NEUTRAL = { x: 700, y: 500 };

type FlyoutState = {
  open: boolean;
  pinned: boolean | null;
  preview: boolean | null;
  filterVisible: boolean;
  filterText: string | null;
};

function flyoutState(): Promise<FlyoutState> {
  return page.evaluate(() => {
    const panel = document.querySelector(".sidebar-flyout");
    const input = document.querySelector<HTMLInputElement>(".sidebar-filter input");
    return {
      open: Boolean(panel),
      pinned: panel ? panel.className.includes("is-pinned") : null,
      preview: panel ? panel.className.includes("is-preview") : null,
      filterVisible: Boolean(input),
      filterText: input ? input.value : null,
    };
  });
}

const rail = (label: string) => page.locator(`.sidebar-nav button[title="${label}"]`);

async function openViewMenu(): Promise<void> {
  await page.locator(".app-menu-trigger", { hasText: "View" }).click();
  await page.waitForSelector(".app-menu-dropdown", { timeout: 5000 });
}

async function reset(): Promise<void> {
  await page.mouse.click(NEUTRAL.x, NEUTRAL.y);
  await page.waitForTimeout(300);
}

const settle = () => settleApp(page);

/** Hovers a rail button and waits for the panel it should preview. Sampling
 * once is not enough: a re-render arriving mid-hover cancels the preview, and
 * that is a test artifact rather than the behaviour under test. */
async function hoverRail(label: string): Promise<void> {
  await settle();
  await rail(label).hover();
  await page.waitForSelector(".sidebar-flyout", { timeout: 5000 });
}

before(async () => {
  harness = await launchApp();
  page = harness.page;
});

after(async () => {
  await harness?.close();
});

describe("sidebar flyout: hover and click through the real DOM", () => {
  it("previews a section on hover and pins it on click", async () => {
    await reset();
    await hoverRail("Notebooks");
    const previewed = await flyoutState();
    assert.equal(previewed.open, true, "hovering the rail should preview the panel");
    assert.equal(previewed.preview, true, "a hovered panel is not pinned");

    await rail("Notebooks").click();
    await page.waitForTimeout(250);
    assert.equal((await flyoutState()).pinned, true, "clicking should pin the panel");

    await rail("Notebooks").click();
    await page.waitForTimeout(250);
    assert.equal((await flyoutState()).open, false, "clicking a pinned panel closes it");
  });

  it("closes an unpinned panel once the pointer has been away for the grace period", async () => {
    await reset();
    await hoverRail("Notebooks");

    await page.mouse.move(NEUTRAL.x, NEUTRAL.y);
    await page.waitForTimeout(60);
    assert.equal((await flyoutState()).open, true, "the panel should outlive a brief exit");

    await page.waitForTimeout(400);
    assert.equal((await flyoutState()).open, false, "the panel should close after 180ms away");
  });

  it("keeps a pinned panel open no matter where the pointer goes", async () => {
    await reset();
    await rail("Notebooks").click();
    await page.waitForTimeout(250);
    await page.mouse.move(NEUTRAL.x, NEUTRAL.y);
    await page.waitForTimeout(600);
    assert.equal((await flyoutState()).pinned, true, "a pinned panel ignores the close timer");
    await reset();
  });
});

describe("sidebar flyout: leaving no state behind", () => {
  // Regression: View > Templates used to clear the open panel while leaving
  // `pinned` true. A hover refuses to replace a pinned panel, so previews then
  // stopped working entirely for every section until one was clicked.
  it("lets hover previews keep working after View > Templates", async () => {
    await reset();
    await rail("Notebooks").click();
    await page.waitForSelector(".sidebar-flyout", { timeout: 5000 });
    await page.locator('.sidebar-flyout [title="Filter notebooks"]').click();
    await page.locator(".sidebar-filter input").fill("zzz");

    const before = await flyoutState();
    assert.equal(before.pinned, true);
    assert.equal(before.filterText, "zzz");

    await openViewMenu();
    await page.locator(".app-menu-dropdown button", { hasText: /^Templates$/ }).click();
    await page.waitForSelector(".sidebar-flyout", { state: "detached", timeout: 5000 });
    assert.equal((await flyoutState()).open, false, "Templates should close the panel");

    await page.mouse.move(NEUTRAL.x, NEUTRAL.y);
    await page.waitForTimeout(100);
    // If `pinned` were left stuck true, no panel ever appears here - which is
    // the regression this test exists for.
    await hoverRail("Notebooks").catch(() =>
      assert.fail("hover must still preview after Templates: pinned state was left behind")
    );

    const previewed = await flyoutState();
    assert.equal(previewed.open, true, "hover must still preview after Templates");
    assert.equal(previewed.preview, true);
    assert.equal(previewed.filterVisible, false, "no filter should survive the close");
    await reset();
  });

  // Defensive: `reveal` cancels a pending hover-close. No UI path is known to
  // reach the race - when the dropdown closes, the pointer lands on the newly
  // exposed panel, whose mouseenter cancels the timer anyway - so this test
  // passes with or without the guard. It is here to keep the menu-bar path
  // honest if either of those details changes.
  it("keeps a panel opened from the menu bar open through the grace period", async () => {
    await reset();
    await openViewMenu();
    await hoverRail("Notebooks");
    assert.equal((await flyoutState()).preview, true);

    await page.mouse.move(NEUTRAL.x, 12);
    await page.locator(".app-menu-dropdown button", { hasText: /^Notebooks$/ }).click();
    await page.waitForTimeout(500);

    const revealed = await flyoutState();
    assert.equal(revealed.open, true, "the menu-opened panel should still be open");
    assert.equal(revealed.pinned, true, "opening from the menu pins the panel");
    await reset();
  });
});
