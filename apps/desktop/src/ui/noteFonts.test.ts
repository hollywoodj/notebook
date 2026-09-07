import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cssFontFamily,
  defaultNoteFontStyles,
  INTER_STACK,
  legacyFontFamily,
  NOTE_FONT_SIZES,
  noteFontStyleVars,
  parseNoteFontStyles,
  patchNoteFontStyle,
  SERIF_STACK,
  stylesFromLegacy,
} from "./noteFonts.ts";

describe("noteFonts", () => {
  it("uses Evernote-sized defaults for body and headers", () => {
    const styles = defaultNoteFontStyles();
    assert.equal(styles.normal.size, 16);
    assert.equal(styles.h1.size, 28);
    assert.equal(styles.h2.size, 22);
    assert.equal(styles.h3.size, 18);
    assert.ok((NOTE_FONT_SIZES as readonly number[]).includes(styles.h2.size));
  });

  it("maps Default / serif / mono onto concrete stacks", () => {
    assert.equal(cssFontFamily(""), INTER_STACK);
    assert.equal(cssFontFamily("default"), INTER_STACK);
    assert.equal(cssFontFamily("serif"), SERIF_STACK);
    assert.equal(legacyFontFamily(SERIF_STACK), "serif");
  });

  it("fills missing style rows and ignores junk sizes", () => {
    const parsed = parseNoteFontStyles({
      normal: { family: "serif", size: 99, color: "#111" },
      h1: { size: "nope" },
    });
    assert.equal(parsed.normal.family, "serif");
    assert.equal(parsed.normal.size, 72);
    assert.equal(parsed.normal.color, "#111");
    assert.equal(parsed.h1.size, 28);
    assert.equal(parsed.h3.size, 18);
  });

  it("exposes CSS variables the editor page can apply", () => {
    const vars = noteFontStyleVars(
      patchNoteFontStyle(defaultNoteFontStyles(), "h1", {
        size: 30,
        color: "#d64545",
      })
    );
    assert.equal(vars["--note-font-size"], "16px");
    assert.equal(vars["--note-h1-size"], "30px");
    assert.equal(vars["--note-h1-color"], "#d64545");
    assert.equal(vars["--note-font-family"], INTER_STACK);
  });

  it("keeps stored font_styles ahead of the old single font_size field", () => {
    const fromLegacy = stylesFromLegacy("serif", 20, undefined);
    assert.equal(fromLegacy.normal.size, 20);
    assert.equal(fromLegacy.normal.family, SERIF_STACK);
    const stored = stylesFromLegacy("mono", 12, {
      normal: { family: "", size: 16, color: "" },
      h1: { family: "", size: 28, color: "" },
      h2: { family: "", size: 22, color: "" },
      h3: { family: "", size: 18, color: "" },
    });
    assert.equal(stored.normal.size, 16);
    assert.equal(stored.normal.family, "");
  });
});
