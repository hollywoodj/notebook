import { htmlToPlainText, noteAppLink } from "./uiChrome.ts";

/** OmniFocus/OmniClone inbox add, matching Inside OmniFocus URL schemes. */
export const OMNI_FOCUS_ADD_PATH = "add";
export const DEFAULT_OMNI_CLONE_SCHEME = "omniclone";

export type OmniCloneSchemePref = "omniclone" | "omnifocus" | "both";

export type OmniFocusAddParams = {
  name: string;
  note?: string;
  due?: string;
  defer?: string;
  flag?: boolean;
  project?: string;
  context?: string;
  autosave?: boolean;
  xSuccess?: string;
};

export type ChecklistTask = {
  title: string;
  checked: boolean;
};

export function parseNotebookUrl(
  raw: string
): { kind: "note"; id: string } | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const match = value.match(
    /^(?:notebook:\/\/\/?|#\/?)note[/:]([^/?#]+)/i
  );
  if (!match?.[1]) return null;
  try {
    const id = decodeURIComponent(match[1]).trim();
    return id ? { kind: "note", id } : null;
  } catch {
    return null;
  }
}

export function omniFocusDueParam(
  iso: string | null | undefined
): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12 || 12;
  const minutePart =
    minutes === 0 ? "" : `:${String(minutes).padStart(2, "0")}`;
  return `${year}-${month}-${day} ${hours}${minutePart}${ampm}`;
}

export function omniFocusNoteField(link: string, snippet?: string): string {
  const extra = (snippet || "").trim();
  return extra ? `${link}\n\n${extra}` : link;
}

function queryString(params: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%20/g, "%20")}`
    );
  }
  return parts.join("&");
}

export function normalizeAppScheme(scheme: string): string {
  return scheme.trim().replace(/:\/\/*$/, "") || DEFAULT_OMNI_CLONE_SCHEME;
}

/** `omnifocus:///add?name=…&note=…` — three slashes, as documented by Omni Group. */
export function buildOmniFocusAddUrl(
  scheme: string,
  params: OmniFocusAddParams
): string {
  const app = normalizeAppScheme(scheme);
  const useCallback = Boolean(params.xSuccess);
  const path = useCallback ? "x-callback-url/add" : OMNI_FOCUS_ADD_PATH;
  const qs = queryString({
    name: params.name.trim() || "Untitled",
    note: params.note,
    due: params.due,
    defer: params.defer,
    flag: params.flag ? "true" : undefined,
    project: params.project,
    context: params.context,
    autosave: params.autosave === false ? "false" : "true",
    "x-success": params.xSuccess,
  });
  return `${app}:///${path}?${qs}`;
}

/** TaskPaper paste into Inbox, the OmniFocus batch equivalent of Mail Drop. */
export function buildOmniFocusPasteUrl(scheme: string, content: string): string {
  const app = normalizeAppScheme(scheme);
  const qs = queryString({
    target: "inbox",
    content,
  });
  return `${app}:///paste?${qs}`;
}

export function extractChecklistTasks(html: string): ChecklistTask[] {
  if (!html) return [];
  const tasks: ChecklistTask[] = [];
  const itemRe = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(html))) {
    const attrs = match[1] || "";
    const inner = match[2] || "";
    const isTask =
      /data-type\s*=\s*["']taskItem["']/i.test(attrs) ||
      /data-checked=/i.test(attrs) ||
      /type=["']checkbox["']/i.test(inner) ||
      /data-inline-checkbox/i.test(inner);
    if (!isTask) continue;
    const checked =
      /data-checked\s*=\s*["']true["']/i.test(attrs) ||
      /data-checked\s*=\s*["']true["']/i.test(inner);
    const title = htmlToPlainText(inner).replace(/\s+/g, " ").trim();
    if (title) tasks.push({ title, checked });
  }
  return tasks;
}

export function checklistToTaskPaper(
  tasks: ChecklistTask[],
  noteLink: string
): string {
  return tasks
    .filter((task) => !task.checked)
    .map((task) => `- ${task.title}\n  ${noteLink}`)
    .join("\n");
}

export function schemesForPref(pref: OmniCloneSchemePref): string[] {
  if (pref === "omnifocus") return ["omnifocus"];
  if (pref === "both") return ["omniclone", "omnifocus"];
  return [DEFAULT_OMNI_CLONE_SCHEME];
}

export function sendUrlsForNote(options: {
  title: string;
  noteId: string;
  snippet?: string;
  reminderAt?: string | null;
  schemePref?: OmniCloneSchemePref;
  sendDue?: boolean;
}): string[] {
  const link = noteAppLink(options.noteId);
  const name = (options.title || "").trim() || "Untitled";
  const note = omniFocusNoteField(link, options.snippet);
  const due =
    options.sendDue === false
      ? undefined
      : omniFocusDueParam(options.reminderAt);
  return schemesForPref(options.schemePref || "omniclone").map((scheme) =>
    buildOmniFocusAddUrl(scheme, {
      name,
      note,
      due,
      autosave: true,
    })
  );
}

export function sendUrlsForChecklists(options: {
  title: string;
  noteId: string;
  html: string;
  schemePref?: OmniCloneSchemePref;
}): string[] {
  const link = noteAppLink(options.noteId);
  const open = extractChecklistTasks(options.html).filter((task) => !task.checked);
  const schemes = schemesForPref(options.schemePref || "omniclone");
  if (!open.length) {
    return sendUrlsForNote({
      title: options.title,
      noteId: options.noteId,
      schemePref: options.schemePref,
      sendDue: false,
    });
  }
  if (open.length === 1) {
    return schemes.map((scheme) =>
      buildOmniFocusAddUrl(scheme, {
        name: open[0].title,
        note: link,
        autosave: true,
      })
    );
  }
  const paper = checklistToTaskPaper(open, link);
  return schemes.map((scheme) => buildOmniFocusPasteUrl(scheme, paper));
}
