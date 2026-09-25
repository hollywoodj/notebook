// A folder picked via a `webkitdirectory` file input reports every file
// under it, including files in subfolders. The desktop app's folder import
// matches the CLI's directory import (crates/notebook-cli), which only
// reads *.enex files directly inside the chosen folder, not recursively.

export interface FolderPickedFile {
  name: string;
  webkitRelativePath: string;
}

/**
 * Keep only the .enex files that sit directly inside the picked folder
 * (case-insensitive extension, no subfolders), sorted by file name.
 */
export function filterTopLevelEnexFiles<T extends FolderPickedFile>(files: T[]): T[] {
  return files
    .filter((file) => {
      if (!/\.enex$/i.test(file.name)) return false;
      const rel = file.webkitRelativePath || file.name;
      // "<folder>/<file>" has exactly one separator; anything in a
      // subfolder has more.
      return rel.split("/").length === 2;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
