# Evernote UI clone handoff

This log is for future sessions continuing the exact-clone work. Passes 1–10 each closed visible Evernote desktop gaps. The goal remains pixel-and-behavior parity with Evernote’s three-pane desktop app (no AI).

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
1. **Sidebar icon rail**: the sidebar rests at 56px of icons, so the list and editor never reflow
2. Rail can be pinned open from the sidebar toggle, the View menu, or Ctrl/⌘ Alt S; the choice persists with the pane layout
3. Sidebar splitter tracks the pointer, so one drag crosses between the rail and a pinned width in either direction

### Pass 6 (this session)
1. The rail **no longer widens under the pointer**. Evernote's collapsed sidebar keeps its width and only shows a tooltip, so hovering here does the same; the sidebar changes width only when you pin it, drag its edge, or hide it
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
9. **Account chip popover** with a hashed avatar color, Account, Settings, and theme
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
2. Sidebar rail icons raised from 16px to 20px so they match the menu density
3. Settings gear removed from the sidebar; Settings stays in File and the account menu
4. OmniClone / OmniFocus integration: Copy Note Link opens `notebook://`, Send to OmniClone uses `omniclone:///add`

## Where to look

- Chrome helpers and tests: `apps/desktop/src/uiChrome.ts`, `apps/desktop/src/uiChrome.test.ts`
- Shell / menus / list / reminder header: `apps/desktop/src/App.tsx`
- Editor: `apps/desktop/src/components/NoteEditor.tsx`
- New dialogs: `JumpToDialog.tsx`, `SearchDialog.tsx`, `CommandPalette.tsx`, `LinkDialog.tsx`, `NotebookPickerDialog.tsx`
- Preferences: `apps/desktop/src/api.ts` (`list_view`) and `crates/notebook-core/src/templates.rs`

Run desktop checks from `apps/desktop`: `npm test` and `npx tsc --noEmit`.

## Future improvements (next clone passes)

Prioritize items that a user can see or click. Skip cloud/AI/sharing unless the product scope changes.

### High-visibility chrome
- Always on top
- Account chip already lives in the footer with a popover; match Evernote’s signed-in menu more closely if needed

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
- Custom highlight colors (seven swatches exist)

### Quality / parity bugs to re-check
- Note-list splitter sometimes feels like it does not move until a larger drag (the sidebar splitter now tracks the pointer instead)
- Hide Sidebar should be verified with a click, not only the menu label
- A drag that collapses the sidebar to the rail leaves the remembered pinned width at the 180px minimum
- Drag-and-drop notes onto notebooks/tags was implemented but QA skipped it
- ArrowUp/ArrowDown with a single note cannot prove non-wrapping selection
- “Add tag” vs Evernote’s “Add a tag”
- Table Tab vs indent: indent yields to the table extension; re-test nested lists inside table cells
- Jump To currently lists non-template notes only; consider templates and trash as optional groups
- Toolbar hide + attach: media button is in the toolbar; drag-and-drop still works when hidden
- Toolbar overflow should be re-checked in a narrow window; font dropdowns take extra width
- Card thumbnails depend on the first image attachment or an `<img>` in the note body

## Intentionally out of scope

- AI assistant / AI search
- Evernote cloud sync, sharing, Work Chat, Spaces
- Web clipper, calendar, home dashboard widgets
- iOS/Android clients (API-first is already in the README)

When closing the next ten, keep stacking on this branch style: helpers in `uiChrome.ts` with tests, visible chrome in `App.tsx` / `NoteEditor.tsx` / `styles.css`, and a short PR list of the items.
