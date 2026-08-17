# Evernote UI clone handoff

This log is for future sessions continuing the exact-clone work. Passes 1–3 each closed ten visible Evernote desktop gaps. The goal remains pixel-and-behavior parity with Evernote’s three-pane desktop app (no AI).

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

### Pass 3 (this session)
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
- Searchable **Move to notebook** dialog (Copy already has a picker; Move is still a nested menu)
- **Empty states** per view (Notes, Notebook, Tag, Reminders, Trash, Shortcuts) with Evernote-style copy and illustration
- **Default notebook star** in the sidebar notebook row
- **Sidebar filter** that narrows notebooks/tags as you type (separate from note search)
- Editor header that looks like Evernote: notebook breadcrumb, icon-only Pin / Shortcut / Reminder / Info, overflow
- **Hide formatting toolbar** / compact toolbar overflow (`…`) when the window is narrow
- **Zoom in/out/reset** for the note body (View menu + Ctrl/⌘ +/- / 0)
- **Always on top** / window title = current note title
- Account footer already exists; match Evernote’s bottom-left user chip + settings gear more closely

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
- Replace currently lives in Find; expose **Find and Replace** as its own Edit item with Ctrl/⌘ H

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
- Sidebar ↔ note-list splitter sometimes feels like it does not move until a larger drag
- Hide Sidebar should be verified with a click, not only the menu label
- Drag-and-drop notes onto notebooks/tags was implemented but QA skipped it
- ArrowUp/ArrowDown with a single note cannot prove non-wrapping selection
- “Add tag” vs Evernote’s “Add a tag”
- Table Tab vs indent: indent yields to the table extension; re-test nested lists inside table cells
- Jump To currently lists non-template notes only; consider templates and trash as optional groups

## Intentionally out of scope

- AI assistant / AI search
- Evernote cloud sync, sharing, Work Chat, Spaces
- Web clipper, calendar, home dashboard widgets
- iOS/Android clients (API-first is already in the README)

When closing the next ten, keep stacking on this branch style: helpers in `uiChrome.ts` with tests, visible chrome in `App.tsx` / `NoteEditor.tsx` / `styles.css`, and a short PR list of the ten items.
