import type { FolderEntry, FileEntry } from '../../main/s3/listTransform';

export type SortKey = 'name' | 'size' | 'lastModified';
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

export const DEFAULT_SORT: SortState = { key: 'name', direction: 'asc' };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Natural, case-insensitive name order ("file2" before "file10"). */
function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

function timestamp(value: string | null): number | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function compareFiles(a: FileEntry, b: FileEntry, key: SortKey): number {
  if (key === 'size') return a.size - b.size;
  if (key === 'lastModified') {
    const ta = timestamp(a.lastModified);
    const tb = timestamp(b.lastModified);
    if (ta === tb) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  }
  return compareNames(a.name, b.name);
}

/** The next sort state after clicking a column header: the active column flips
 *  direction, a different column starts ascending. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  return { key, direction: 'asc' };
}

/** Sort a listing for display. Folders stay above files; they have no size or
 *  date, so they are always ordered by name (following the direction only when
 *  sorting by name). Ties fall back to name order so the result is stable. */
export function sortEntries(
  folders: FolderEntry[],
  files: FileEntry[],
  sort: SortState,
): { folders: FolderEntry[]; files: FileEntry[] } {
  const sign = sort.direction === 'asc' ? 1 : -1;
  const folderSign = sort.key === 'name' ? sign : 1;

  const sortedFolders = [...folders].sort((a, b) => folderSign * compareNames(a.name, b.name));
  const sortedFiles = [...files].sort((a, b) => {
    const primary = compareFiles(a, b, sort.key);
    if (primary !== 0) {
      // Entries without a date stay at the bottom regardless of direction.
      if (sort.key === 'lastModified' && (a.lastModified === null || b.lastModified === null)) return primary;
      return sign * primary;
    }
    return compareNames(a.name, b.name);
  });

  return { folders: sortedFolders, files: sortedFiles };
}
