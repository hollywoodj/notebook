import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collapseAllIds,
  hasVisibleSidebarNotebooks,
  matchesSidebarFilter,
  notebooksMatchingFilter,
  parseCollapsedStacks,
  sidebarFilterLabel,
  sidebarFlyoutAfterClick,
  sidebarFlyoutAfterHover,
  sidebarFlyoutTitle,
  toggleCollapsedId,
} from "./sidebar.ts";

describe("sidebar flyouts", () => {
  it("previews on hover without replacing a pinned panel", () => {
    assert.deepEqual(sidebarFlyoutAfterHover(null, false, "tags"), {
      flyout: "tags",
      pinned: false,
    });
    assert.deepEqual(sidebarFlyoutAfterHover("notebooks", true, "tags"), {
      flyout: "notebooks",
      pinned: true,
    });
  });

  it("pins a hover preview and toggles only a pinned panel closed", () => {
    assert.deepEqual(sidebarFlyoutAfterClick("tags", false, "tags"), {
      flyout: "tags",
      pinned: true,
    });
    assert.deepEqual(sidebarFlyoutAfterClick("tags", true, "tags"), {
      flyout: null,
      pinned: false,
    });
    assert.deepEqual(sidebarFlyoutAfterClick("tags", true, "notebooks"), {
      flyout: "notebooks",
      pinned: true,
    });
  });

  it("titles and filters each panel after its own section", () => {
    assert.equal(sidebarFlyoutTitle("shortcuts"), "Shortcuts");
    assert.equal(sidebarFlyoutTitle("notebooks"), "Notebooks");
    assert.equal(sidebarFlyoutTitle("tags"), "Tags");
    assert.equal(sidebarFilterLabel("notebooks"), "Filter notebooks");
    assert.equal(sidebarFilterLabel("tags"), "Filter tags");
  });
});

describe("sidebar filter", () => {
  it("narrows notebooks unless the stack name matches", () => {
    const notebooks = [{ name: "Work" }, { name: "Recipes" }];
    assert.deepEqual(
      notebooksMatchingFilter(notebooks, "Personal", "rec").map((item) => item.name),
      ["Recipes"]
    );
    assert.deepEqual(
      notebooksMatchingFilter(notebooks, "Personal", "per").map((item) => item.name),
      ["Work", "Recipes"]
    );
    assert.equal(matchesSidebarFilter("travel", "TRA"), true);
    assert.equal(matchesSidebarFilter("travel", "home"), false);
    assert.equal(
      hasVisibleSidebarNotebooks([{ name: "Work" }], [{ name: "Personal" }], "per"),
      true
    );
    assert.equal(
      hasVisibleSidebarNotebooks([{ name: "Work" }], [{ name: "Personal" }], "zzz"),
      false
    );
  });
});

describe("collapsed stacks", () => {
  it("toggles one stack and can collapse every stack", () => {
    assert.deepEqual(toggleCollapsedId(["a"], "b"), ["a", "b"]);
    assert.deepEqual(toggleCollapsedId(["a", "b"], "a"), ["b"]);
    assert.deepEqual(collapseAllIds(["s1", "s2", "s1"]), ["s1", "s2"]);
    assert.deepEqual(parseCollapsedStacks(JSON.stringify(["s1"])), ["s1"]);
    assert.deepEqual(parseCollapsedStacks("nope"), []);
  });
});
