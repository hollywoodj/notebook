# Evernote UI clone handoff

This log is for future sessions continuing the exact-clone work. Passes 1–10 each closed visible Evernote desktop gaps. The goal remains pixel-and-behavior parity with Evernote’s three-pane desktop app (AI was out of scope for these clone passes).

## Closed so far

### Pass 1
1. Reminders (sidebar, badges, overdue, datetime picker)
2. Note info panel (created/updated, source URL, copy `notebook://note/{id}`)
3. Note history (list/preview/restore)
4. Tag chips under the editor
5. Resizable panes + Hide Sidebar
6. Find in note (Ctrl/⌘ F); global search is Ctrl/⌘ Shift F
7. Print (Ctrl/⌘ P)
8. Sidebar counts
9. Drag notes onto notebooks/tags
10. List Up/Down + status bar

### Pass 2
1. Date-grouped note list (Pinned / Today / Yesterday / Previous 7 Days / Earlier)
2. Format and Edit menus wired to TipTap
3. Highlight color picker
4. Horizontal rule + insert date/time
5. Editor right-click context menu
6. In-app confirm dialog
7. New Stack from File and sidebar menus
8. Merge selected notes
9. Export note as HTML or Evernote `.enex`
10. Focus mode (F11) + search-hit highlighting in list snippets

### Pass 3
1. Insert table (toolbar, Format menu, editor context; add/delete rows and columns)
2. Text alignment (left / center / right)
3. Indent / outdent (toolbar, Format, Tab / Shift+Tab; lists sink/lift)
4. Text color picker (red / orange / green / blue / purple)
5. Note list views: Snippets / Titles / Cards (list header + View menu + Settings)
6. Jump to… (Ctrl/⌘ J) for notes, notebooks, and tags
7. Reminder bell in the editor header with Tonight / Tomorrow / Next week / pick date
8. Insert/edit link dialog (replaces `window.prompt`)
9. Hide Note List (View menu; layout persisted with pane widths)
10. Copy to notebook (context submenu, Note menu, searchable picker)

### Pass 4 (this session)
1. Searchable **Move to notebook** dialog (context, Note menu, overflow, bulk bar; Copy uses the same picker)
2. **Empty states** per view (Notes, Notebook, Tag, Reminders, Trash, Shortcuts, Search, Templates)
3. **Default notebook star** on the sidebar notebook row
4. **Sidebar filter** that narrows notebooks and tags as you type
5. Editor header: notebook breadcrumb + icon-only Pin / Shortcut / Reminder / Info / overflow
6. **Hide formatting toolbar** (View menu; persisted)
7. **Zoom in/out/reset** for the note body (View menu + Ctrl/⌘ +/- / 0; status bar %)
8. **Window title** = current note title
9. Account **footer** chip (avatar, name, email) + settings gear
10. **Find** (Ctrl/⌘ F) vs **Find and Replace** (Ctrl/⌘ H) as separate Edit items

### Pass 5
1. **Sidebar icon rail** (later removed): the sidebar used to rest at 56px of icons
2. Rail could be pinned open from the sidebar toggle, the View menu, or Ctrl/⌘ Alt S
3. Sidebar splitter tracks the pointer so one drag follows the edge in either direction

### Pass 6 (this session)
1. Hovering the sidebar **does not change its width**; Hide Sidebar is the way to tuck it away
2. **Tags open in a panel** beside the sidebar, the way Shortcuts and Notebooks already did, instead of expanding inline and pushing Templates and Trash down
3. Every panel shares one shape: title, filter, add button, close; the filter is named for its own section (`Filter notebooks`, `Filter tags`) and resets when you switch sections
4. Clicking the section that is already open closes its panel; Escape and a click outside the sidebar close it too
5. View menu gained **Notebooks** and **Tags** entries that open the matching panel

### Pass 7
1. **Compact toolbar overflow** (`…`) when the formatting bar is too narrow
2. **Font family and size** dropdowns in the toolbar (and a Format → Font menu)
3. **Nested Format menus** for Highlight, Text Color, Align, and Table
4. **Card thumbnails** from the first image attachment or inline image
5. **List metadata** as its own row: reminder time, attachment count, checklist progress
6. **Recent searches** under Search, persisted locally
7. **Filter chips** for Has reminder and Has attachment
8. **Link dialog** Open / Copy, and display text is always applied
9. **Account chip popover** with a hashed avatar color, Account, and Settings
10. **Collapse / expand stacks** (click, context menu, View menu)

### Pass 8 (this session)
1. **J / K** note-list navigation when a text field is not focused (arrows still work)
2. **Note outline / table of contents** from headings (View menu; persisted)
3. **Superscript and subscript** in the toolbar and Format menu
4. **Callout boxes** (info / warning / tip)
5. **Copy as** rich text, plain text, or Markdown
6. **Export as Markdown** (File, Note, and note context)
7. **Export notebook as Evernote XML** from the notebook context menu
8. **Search operators** `notebook:`, `tag:`, `intitle:`, `reminder:`, `todo:` plus search-in-this-notebook
9. **Date range filter chips**: Today / This week / This month
10. **Snooze reminder**: Later today (+3h) and Tomorrow morning (9am)

### Pass 9 (this session)
1. **Back / Forward** in the tab bar (View menu + Ctrl/⌘ [ and ])
2. **Circular pill tabs** with the **+** button immediately after the last tab
3. **Search popup** (sidebar Search, Ctrl/⌘ K, Ctrl/⌘ Shift F) with recent searches and Go to

### Pass 10 (this session)
1. **Named saved searches** in the search popup (save, run, delete; persisted locally)
2. **Reminder agenda grouping**: Overdue / Today / Tomorrow / Later / Completed
3. **Mark reminder done** without clearing the datetime (list, menus, reminder popover)
4. **Email note** (`mailto:` from File, Note, context, and the note overflow menu)
5. **Code block language** select in the formatting toolbar
6. **Create tag from the tag bar** when the typed name does not exist
7. **Hover preview** of a note in the list
8. **Reopen last session** (last filter + note, unless startup is Shortcuts)
9. **Group search results by notebook**
10. **Command palette** (Ctrl/⌘ Shift P) for actions, distinct from Jump to

### Pass 11 (this session)
1. **Match case** in Find
2. **Whole word** in Find
3. **Find Next / Previous** (F3 / Shift+F3, Edit menu)
4. **Paste and Match Style**
5. **Insert Date** and **Insert Time** as separate Format items
6. **Extra highlight colors** (orange, purple, gray)
7. **Increase / decrease font size**
8. **Remove Link**
9. **Insert Table of Contents** from the outline
10. **Copy** button on code blocks
11. **Image size presets** (Small / Medium / Large / Original)
12. **Image captions**
13. Search operators **created:** / **updated:** / **resource:** / **untagged:** / **-minus**
14. **Untagged** filter chip
15. **Archived** notes view (hidden from All Notes)
16. **Sort by reminder**
17. **Collapse date groups** in the note list
18. **List density toggle** in the list header
19. **Clear filters**
20. **Relative dates** in list rows
21. **Tab context menu** (Close / Close Others / Close to the Right / Reopen Closed Tab)
22. **Rename note**
23. **Copy title**
24. **Add tag** submenu on a note
25. **Reading time** in the status bar
26. **Character count** in note info
27. **Export as PDF**
28. **Undo trash** toast
29. **Go to Notebook** (Ctrl/⌘ Alt J)
30. **Saved searches** listed in the sidebar

### Pass 12 (this session)
1. **Show / hide status bar**
2. **Spellcheck wavy underline**
3. **Spellcheck language**
4. **Image resize handles**
5. **Image lightbox** (double-click)
6. **Image align** left / center / right
7. **Has image / Has URL / Has checklist** chips
8. **Reverse sort**
9. **Collapse / expand all date groups**
10. **List count** as “N notes”
11. **Keyboard shortcuts overlay** (Ctrl/⌘ /)
12. **Pin tab**
13. **Recently viewed notes**
14. **Go to Tag** (Ctrl/⌘ Alt T)
15. **Home / End** in the note list
16. **PageUp / PageDown** in the note list
17. **Check all / Uncheck all tasks**
18. **Line spacing**
19. **Lock note**
20. **Note color** banner
21. **Sidebar section order**
22. **Reminders calendar**
23. **Hide completed reminders**
24. **Open notebook from the header crumb**
25. **Selection word count**
26. **Unsaved dot** on the active tab
27. **Close all tabs**
28. **F2 to rename** a note
29. **Open selected notes in new tabs**
30. **Rename saved search**

### Pass 13 (menu bar + OmniClone)
1. Application menu bar tightened to Evernote’s 22px row height, 13px type, and tighter item/shortcut spacing
2. Sidebar nav icons raised from 16px to 20px so they match the menu density
3. Settings gear removed from the sidebar; Settings stays in File and the account menu
4. OmniClone / OmniFocus integration: Copy Note Link opens `notebook://`, Send to OmniClone uses `omniclone:///add`

### Pass 14 (this session)
1. **Sidebar flyout pops faster**: 80ms opacity fade (no slide), 1px overlap + 8px hover bridge so the panel survives the trip from the rail
2. **220ms close grace** (was 180ms) — still immediate on hover; native tooltips removed from Shortcuts / Notebooks / Tags so they do not fight the panel
3. **Files on the sidebar rail**, gated on the existing `show_files` setting
4. **ENEX images become attachments** with `notebook-attachment://` in `<img>` instead of base64 data URIs, so they show in Files and as card thumbnails
5. **Audio, office docs, octet-stream, Windows paths, and UTF-16 ENEX** import as real attachments
6. **Import status** includes the first error hint when notes are skipped
7. **Add a tag** wording on the note menu; duplicate tag-filter setState removed
8. ~~**Account chip** restored on the sidebar rail (avatar opens Account / Settings)~~ — removed for now; Settings stays in File

### Pass 15 (this session)
Account avatar removed from the sidebar rail (Settings stays in File). Ten chrome gaps closed:

1. **Hide Sidebar button** in the note chrome, next to Hide note list
2. **Hide/Show Sidebar** in the sidebar More (•••) menu
3. **Minimize** in a new Window menu (Ctrl/⌘ M)
4. **Zoom** (maximize / restore) in the Window menu
5. **Keep on Top** in the Window menu, persisted
6. **Show/Hide Status Bar** in View
7. **Enable/Disable Spell Check** in Edit (same setting as Preferences)
8. **New stack** in the sidebar More menu
9. **Jump To / Search include templates** and open the Templates view
10. **Search in this notebook** in the note-list header when a notebook is selected

Shortcut overlay also lists Hide Sidebar and Jump To templates.

### Pass 16 (this session)
Visual fidelity for Settings and the note editor. No Tasks, Calendar, or Daily note.

1. **Inter** as the UI and note font (Evernote’s 2024 typeface), 13px chrome
2. **Editor line spacing**: body 16/24 (line-height 1.5); paragraphs have no extra margin so Enter is one line
3. **Heading sizes** match Evernote defaults: Large 28, Medium 22, Small 18
4. **Title** is 32px bold in the readable column, under the notebook crumb
5. **Note list** row padding, 14px titles, 13/18 snippets
6. **Settings → Notes** Default font settings (Normal / Large / Medium / Small: family, size, color)
7. **Aa** text-style menu in the formatting toolbar, with Reset
8. Format menu uses Large / Medium / Small header labels
9. Readable note column is 720px with 48px side padding
10. Checklists and lists use the same line spacing as body text

### Pass 17 (this session)
Visible chrome on existing surfaces only. No Tasks, Calendar, or Daily note.

1. **Add a tag** placeholder always, plus Ctrl/⌘ ' to focus the tag field
2. Highlight palette now has Evernote’s seven swatches (orange, purple, gray added)
3. **Jump To** includes trashed notes (subtitle Trash) and opens them in Trash
4. Note list omits the notebook name when that notebook is already the filter
5. List **date sits on the right** of the title row
6. Search placeholder is **Search notes** (operators still work)
7. **Updated {relative}** under the note title
8. Status bar save copy: **All changes saved** / **Saving…** / **Couldn't save**
9. **Filters** button hides the chip row until opened (count badge when active)
10. Settings → Notes no longer duplicates **Show snippets** (list view select is enough)

Find in note already showed `N of M`; the count uses tabular numbers so it stays readable.

### Pass 18 (this session)
Formatting toolbar match. No Tasks, Calendar, or Daily note.

1. **Insert (+)** menu on the far left of the formatting toolbar
2. **Undo / Redo** arrows next to Insert
3. **Compact primary row**: Aa, font, size, color, B/I/U, highlight, lists, link — headings, align, extras moved out
4. **More (…)** always visible with align, indent, strikethrough, super/sub, remove formatting
5. **Slash commands** (`/` on a new line) open the Insert menu
6. **Checkbox** in Insert (static box, not a checklist)
7. **Print…** and **Note history** in the note ⋯ menu
8. **Evernote format shortcuts**: Highlight Ctrl/⌘ Shift H, Strikethrough Ctrl/⌘ T, bullets Ctrl/⌘ Shift B, remove formatting Ctrl/⌘ Shift Space, font size Ctrl/⌘ Shift > / <
9. **Format menu**: Uncheck All Tasks actually unchecks; duplicate Insert Date/Time rows removed
10. **Floating selection toolbar** (Bold / Italic / Underline / Highlight / Link)

## Where to look

- Chrome helpers and tests: `apps/desktop/src/ui/editorChrome.ts`, `apps/desktop/src/ui/noteFonts.ts`
- Shell / menus / list / reminder header: `apps/desktop/src/App.tsx`
- Editor: `apps/desktop/src/components/NoteEditor.tsx`
- Settings: `apps/desktop/src/components/SettingsModal.tsx`
- New dialogs: `JumpToDialog.tsx`, `SearchDialog.tsx`, `CommandPalette.tsx`, `LinkDialog.tsx`, `NotebookPickerDialog.tsx`
- Preferences: `apps/desktop/src/api.ts` (`list_view`) and `crates/notebook-core/src/templates.rs`

Run desktop checks from `apps/desktop`: `npm test` and `npm run typecheck`. The typecheck covers
the app (`tsconfig.json`, which is `src` minus its tests) and then `e2e` (`tsconfig.e2e.json`),
which needs its own config for the Node types the app does not use.

`npm run test:e2e` drives the real Electron app for behaviour the unit tests cannot see: which
handler is on which element, whether a real `mouseleave` reaches a timer, whether a menu item is
wired to the command it claims. It starts Vite if it is not already running, uses a throwaway
`--user-data-dir` so it never opens your real database, and needs the release backend
(`cargo build --release -p notebook-api`) because that is what the dev app spawns. The script
runs files one at a time (`--test-concurrency=1`) so they do not race two Vite servers.
`e2e/sidebarFlyout.e2e.ts` covers the rail flyout; `e2e/noteChrome.e2e.ts` covers Hide Sidebar,
the Window menu, Jump To templates, Search in this notebook, and the Insert / More / slash toolbar.
the Window menu, Jump To templates, and Search in this notebook. Neither
runner takes a glob: a new `e2e/*.e2e.ts` file does not run until it is added to the
`test:e2e` script, exactly like `src/**/*.test.ts` and `test`.

## Future improvements (next clone passes)

Prioritize items that a user can see or click. Skip cloud/AI/sharing unless the product scope changes.

### High-visibility chrome
- Account chip can return later if we want Evernote’s signed-in menu on the rail

### Note list
- Drag to reorder notebooks and tags

### Editor
- Paste from Word/Google Docs with fewer extra spans
- Audio notes / sketches / handwritten — out of scope unless requested

### Reminders & tasks
- Evernote Tasks are a separate product surface; only add if cloning that explicitly

### Import / export / files
- PDF annotate / ink — not needed for a notes clone unless requested

### Keyboard & power user
- Customizable shortcuts
- Nest remaining menus the way Format now nests Align / Table / Color / Callout

### Settings & theming
- Dark theme

### Quality / parity bugs to re-check
- Note-list splitter sometimes feels like it does not move until a larger drag (the sidebar splitter now tracks the pointer instead)
- Hide Sidebar should be verified with a click in the note chrome and the More menu
- Drag-and-drop notes onto notebooks/tags was implemented but QA skipped it
- ArrowUp/ArrowDown with a single note cannot prove non-wrapping selection
- Table Tab vs indent: indent yields to the table extension; re-test nested lists inside table cells
- Toolbar hide + attach: media button is in the toolbar; drag-and-drop still works when hidden
- Toolbar overflow should be re-checked in a narrow window; font dropdowns take extra width. Pass 18’s always-visible More menu now holds overflowed primary controls plus align/indent/strike.
- Card thumbnails depend on the first image attachment or an `<img>` in the note body

## Intentionally out of scope for the clone passes

- AI assistant / AI search (see `tools/notebook-mcp/` for the separate Claude integration added later)
- Evernote cloud sync, sharing, Work Chat, Spaces
- Web clipper, calendar, home dashboard widgets
- iOS/Android clients (API-first is already in the README)

When closing the next ten, keep stacking on this branch style: helpers in `uiChrome.ts` with tests, visible chrome in `App.tsx` / `NoteEditor.tsx` / `styles.css`, and a short PR list of the items.


## Recovery verified — 2026-09-08

The September 7 Pass 18 session finished successfully. Its 230 unit tests, typecheck, and 20 real Electron UI tests pass again. The latest release backend and desktop UI have been packaged into apps/desktop/release/win-unpacked. The taskbar shortcut now uses the shared launcher so later source changes are rebuilt. The launcher checks app.asar freshness and uses electron:pack for everyday local builds.

An abandoned Cursor debug API was occupying port 8799. It was stopped. The e2e harness now refuses to run while that port is occupied, preventing a test window from connecting to another database despite its temporary profile. All 20 e2e tests were rerun with the port free. Close the normal app before running e2e tests.


## Code review — 2026-09-08

Working overflow controls and toolbar sizing; keyboard formatting; unclipped/scrolling menus; locked-note transaction guard, context-menu protection, and locked checkboxes; slash commands excluded from code blocks. 230 unit tests, 89 Rust tests, 25 Electron UI tests, typecheck/unused-code checks, and final Windows package smoke checks pass.

Full review: C:/Users/James/Dev/Scripts/app-code-review-2026-09-08/REVIEW.md
