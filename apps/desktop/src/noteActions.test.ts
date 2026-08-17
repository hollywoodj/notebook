import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNoteActions, type NoteActionApi } from "./noteActions.ts";

const prefs = {
  confirm_delete: true,
  new_note_behavior: "blank" as const,
};

function summary(id: string, title: string) {
  return { id, title, is_pinned: false, is_archived: false, is_template: false, tag_ids: [] };
}

function fakeApi(overrides: Partial<NoteActionApi> = {}): NoteActionApi {
  const missing = async () => {
    throw new Error("unexpected api call");
  };
  return {
    getNote: missing,
    createNote: missing,
    updateNote: missing,
    deleteNote: missing,
    permanentlyDeleteNote: missing,
    restoreNote: missing,
    addShortcut: missing,
    removeShortcut: missing,
    useTemplate: missing,
    ...overrides,
  };
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    api: fakeApi(),
    notes: [summary("a", "A"), summary("b", "B")],
    selectedNoteIds: new Set<string>(),
    activeNote: null,
    filter: { type: "all" as const },
    prefs,
    lastClickedNoteId: { current: null as string | null },
    setActiveNote: () => {},
    setSelectedNoteIds: () => {},
    setPendingConfirm: () => {},
    setNotebookPicker: () => {},
    setShowGallery: () => {},
    setShowNewMenu: () => {},
    refreshNotes: async () => {},
    refreshMeta: async () => {},
    loadNote: async () => {},
    ...overrides,
  } as Parameters<typeof createNoteActions>[0];
}

describe("createNoteActions", () => {
  it("targets the multi-selection, then the active note", () => {
    const selected = createNoteActions(
      deps({
        selectedNoteIds: new Set(["b"]),
        activeNote: { id: "a" },
      })
    );
    assert.deepEqual(selected.targetNoteIds(), ["b"]);

    const active = createNoteActions(
      deps({
        notes: [summary("a", "A")],
        activeNote: { id: "a" },
      })
    );
    assert.deepEqual(active.targetNoteIds(), ["a"]);
  });

  it("trashes selected notes after confirm", async () => {
    const deleted: string[] = [];
    let refreshed = false;
    const actions = createNoteActions(
      deps({
        api: fakeApi({
          deleteNote: async (id) => {
            deleted.push(id);
          },
        }),
        notes: [summary("a", "Agenda")],
        selectedNoteIds: new Set(["a"]),
        prefs: { ...prefs, confirm_delete: false },
        lastClickedNoteId: { current: "a" },
        refreshNotes: async () => {
          refreshed = true;
        },
      })
    );
    await actions.deleteSelectedNotes();
    assert.deepEqual(deleted, ["a"]);
    assert.equal(refreshed, true);
  });

  it("creates a blank note in the requested notebook", async () => {
    const loaded: string[] = [];
    const actions = createNoteActions(
      deps({
        api: fakeApi({
          createNote: async (notebookId) => {
            assert.equal(notebookId, "nb-work");
            return { id: "n-new", notebook_id: notebookId };
          },
        }),
        notes: [],
        loadNote: async (id: string) => {
          loaded.push(id);
        },
      })
    );
    await actions.createBlankNote("nb-work");
    assert.deepEqual(loaded, ["n-new"]);
  });
});
