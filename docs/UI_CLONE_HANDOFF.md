# Evernote UI clone handoff

This log is for future sessions continuing the exact-clone work. Passes 1–4 each closed ten visible Evernote desktop gaps. The goal remains pixel-and-behavior parity with Evernote’s three-pane desktop app (no AI).

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

### Pass 5 (this session)
1. **Sidebar icon rail**: the sidebar rests at 56px of icons and floats open over the note list on hover or keyboard focus, so the list and editor never reflow
2. Rail can be pinned open from the sidebar toggle, the View menu, or Ctrl/⌘ Alt S; the choice persists with the pane layout
3. Sidebar splitter tracks the pointer, so one drag crosses between the rail and a pinned width in either direction

## Where to look

- Chrome helpers and tests: `apps/desktop/src/uiChrome.ts`, `apps/desktop/src/uiChrome.test.ts`
- Shell / menus / list / reminder header: `apps/desktop/src/App.tsx`
- Editor: `apps/desktop/src/components/NoteEditor.tsx`
- New dialogs: `JumpToDialog.tsx`, `LinkDialog.tsx`, `NotebookPickerDialog.tsx`
- Preferences: `apps/desktop/src/api.ts` (`list_view`) and `crates/notebook-core/src/templates.rs`

Run desktop checks from `apps/desktop`: `npm test` and `npx tsc --noEmit`.

## Future improvements (next clone passes)

Prioritize items that a user can see or click. Skip cloud/AI/sharing unless the product scope changes.

### High-visibility chrome
- Compact toolbar overflow (`…`) when the window is narrow
- Always on top
- Account chip already lives in the footer; match avatar color / popover more closely if needed

### Note list
- **Thumbnails** in Cards view (first image attachment / inline image)
- Attachment count, checklist progress, and reminder time as distinct list metadata (not only icons)
- Saved searches / recent searches under Search
- Filter chips: has reminder, has attachment, created/updated date range
- Drag to reorder notebooks and tags; collapse/expand all stacks
- Hover preview of a note (optional; Evernote v10 is weaker here, legacy is stronger)

### Editor
- Table of contents / outline for headings
- Font family and size **in the toolbar** (prefs exist only in Settings today)
- Justify alignment, inline code, superscript/subscript
- Callout / colored info boxes
- Insert checkbox without converting the whole block to a task list (Evernote mixed checklists)
- Better link dialog: display text always applied to an existing selection; open/copy link
- Paste from Word/Google Docs with fewer extra spans
- Spellcheck underline styling; language picker
- Code block language label
- Image resize handles and border; caption under images
- Audio notes / sketches / handwritten — out of scope unless requested

### Reminders & tasks
- Dedicated reminders calendar / agenda view
- Snooze (later today, tomorrow morning) from the list
- Mark reminder done without deleting the datetime
- Evernote Tasks are a separate product surface; only add if cloning that explicitly

### Search
- Operators in the search box: `notebook:`, `tag:`, `intitle:`, `reminder:`, `todo:`
- Search results grouping and “search in this notebook”

### Import / export / files
- Export selected notes as PDF / Markdown
- Copy note as rich text / plain text / Markdown
- Email note (mailto with HTML body)
- ENEX export of a whole notebook from the notebook context menu
- PDF annotate / ink — not needed for a notes clone unless requested

### Keyboard & power user
- Command palette beyond Jump to (actions: new note, merge, export, settings)
- `J` / `K` note navigation when the list is focused
- Go to notebook (`Ctrl/⌘ Alt J` style)
- Customizable shortcuts
- Menu bar nested submenus (Format → Align, Format → Table) instead of a long flat list

### Settings & theming
- Note list density + view persisted together more cleanly (`list_view` now exists; `show_snippets` is derived)
- Custom highlight colors
- Sidebar section order
- Start in last notebook / last note (startup view is only Notes / Shortcuts / Notebook)

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

## Intentionally out of scope

- AI assistant / AI search
- Evernote cloud sync, sharing, Work Chat, Spaces
- Web clipper, calendar, home dashboard widgets
- iOS/Android clients (API-first is already in the README)

When closing the next ten, keep stacking on this branch style: helpers in `uiChrome.ts` with tests, visible chrome in `App.tsx` / `NoteEditor.tsx` / `styles.css`, and a short PR list of the ten items.
