/** Pure helpers for the Files view: the attachment browser behind the sidebar's Files tab. */

export type FileKind = "image" | "document" | "audio" | "video" | "other";
export type FileKindFilter = FileKind | "all";
export type FileSort = "recent" | "name" | "size";

export const FILE_KIND_FILTERS: { id: FileKindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "document", label: "Documents" },
  { id: "audio", label: "Audio" },
  { id: "video", label: "Video" },
  { id: "other", label: "Other" },
];

/** The shape the Files view needs; `AttachmentSummary` satisfies it. */
export interface FileLike {
  filename: string;
  mime_type: string;
  size: number;
  created_at: string;
  note_title: string;
  notebook_name: string;
}

const DOCUMENT_MIME_HINTS = [
  "pdf",
  "msword",
  "officedocument",
  "opendocument",
  "ms-excel",
  "ms-powerpoint",
  "rtf",
  "epub",
  "csv",
  "json",
  "xml",
];

const DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "odt",
  "rtf",
  "txt",
  "md",
  "csv",
  "tsv",
  "xls",
  "xlsx",
  "ods",
  "ppt",
  "pptx",
  "odp",
  "epub",
  "pages",
  "numbers",
  "key",
]);

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "heic",
  "tif",
  "tiff",
  "avif",
]);

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "flac", "wma"]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv"]);

export function fileExtension(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

/** Short badge shown on a file tile, e.g. "PDF". Falls back to the mime subtype. */
export function fileExtensionLabel(filename: string, mimeType = ""): string {
  const ext = fileExtension(filename);
  if (ext) return ext.slice(0, 4).toUpperCase();
  const subtype = mimeType.split("/")[1] || "";
  return subtype ? subtype.slice(0, 4).toUpperCase() : "FILE";
}

/**
 * Buckets a file for the type chips. Mime wins when it is specific; uploads that
 * arrive as `application/octet-stream` are classified by extension instead.
 */
export function fileKind(mimeType: string, filename: string): FileKind {
  const mime = (mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/")) return "document";
  if (DOCUMENT_MIME_HINTS.some((hint) => mime.includes(hint))) return "document";

  const ext = fileExtension(filename);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  return "other";
}

export function fileKindLabel(kind: FileKind): string {
  switch (kind) {
    case "image":
      return "Image";
    case "document":
      return "Document";
    case "audio":
      return "Audio";
    case "video":
      return "Video";
    default:
      return "File";
  }
}

export function fileKindCounts(files: FileLike[]): Record<FileKindFilter, number> {
  const counts: Record<FileKindFilter, number> = {
    all: files.length,
    image: 0,
    document: 0,
    audio: 0,
    video: 0,
    other: 0,
  };
  for (const file of files) {
    counts[fileKind(file.mime_type, file.filename)] += 1;
  }
  return counts;
}

/** Matches the filename, the note it came from, and its notebook, so a file is findable by any of them. */
export function fileMatchesQuery(file: FileLike, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    file.filename.toLowerCase().includes(needle) ||
    file.note_title.toLowerCase().includes(needle) ||
    file.notebook_name.toLowerCase().includes(needle)
  );
}

export function filterFiles<T extends FileLike>(
  files: T[],
  options: { kind?: FileKindFilter; query?: string; notebookId?: string | null } = {}
): T[] {
  const kind = options.kind ?? "all";
  const query = options.query ?? "";
  return files.filter((file) => {
    if (kind !== "all" && fileKind(file.mime_type, file.filename) !== kind) return false;
    return fileMatchesQuery(file, query);
  });
}

export function sortFiles<T extends FileLike>(files: T[], sort: FileSort): T[] {
  const sorted = [...files];
  sorted.sort((a, b) => {
    if (sort === "name") return a.filename.localeCompare(b.filename);
    if (sort === "size") return b.size - a.size;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  return sorted;
}

/** "3 files · 1.2 MB" style summary for the panel header. */
export function fileTotalsLabel(files: FileLike[], formatSize: (bytes: number) => string): string {
  const count = files.length;
  const label = count === 1 ? "1 file" : `${count} files`;
  if (count === 0) return "No files";
  const bytes = files.reduce((total, file) => total + (file.size || 0), 0);
  return `${label} · ${formatSize(bytes)}`;
}

export function filesEmptyCopy(
  kind: FileKindFilter,
  query: string
): { title: string; body: string } {
  if (query.trim()) {
    return {
      title: "No matching files",
      body: `No files matched “${query.trim()}”. Try another search.`,
    };
  }
  if (kind !== "all") {
    const label = FILE_KIND_FILTERS.find((entry) => entry.id === kind)?.label ?? "files";
    return {
      title: `No ${label.toLowerCase()} yet`,
      body: "Attach a file to a note and it will show up here.",
    };
  }
  return {
    title: "No files yet",
    body: "Files you attach to notes are collected here, across every notebook.",
  };
}

export const FILES_VIEW_KEY = "notebook.filesView";

export interface FilesViewState {
  kind: FileKindFilter;
  sort: FileSort;
  layout: "grid" | "list";
}

export function defaultFilesViewState(): FilesViewState {
  return { kind: "all", sort: "recent", layout: "grid" };
}

export function parseFilesViewState(raw: string | null): FilesViewState {
  const state = defaultFilesViewState();
  if (!raw) return state;
  try {
    const parsed = JSON.parse(raw) as Partial<FilesViewState>;
    if (FILE_KIND_FILTERS.some((entry) => entry.id === parsed.kind)) {
      state.kind = parsed.kind as FileKindFilter;
    }
    if (parsed.sort === "recent" || parsed.sort === "name" || parsed.sort === "size") {
      state.sort = parsed.sort;
    }
    if (parsed.layout === "grid" || parsed.layout === "list") {
      state.layout = parsed.layout;
    }
  } catch {
    return state;
  }
  return state;
}
