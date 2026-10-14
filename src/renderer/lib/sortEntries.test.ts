import { describe, it, expect } from 'vitest';
import { sortEntries, nextSort, DEFAULT_SORT } from './sortEntries';
import type { FileEntry, FolderEntry } from '../../main/s3/listTransform';

function file(name: string, size: number, lastModified: string | null): FileEntry {
  return { name, key: `p/${name}`, size, lastModified, storageClass: null, etag: null };
}

function folder(name: string): FolderEntry {
  return { name, prefix: `p/${name}/` };
}

const files = [
  file('file10.txt', 300, '2024-01-03T00:00:00.000Z'),
  file('File2.txt', 100, '2024-01-01T00:00:00.000Z'),
  file('a.txt', 200, null),
  file('b.txt', 100, '2024-01-02T00:00:00.000Z'),
];
const folders = [folder('zeta'), folder('Alpha'), folder('beta')];

const names = (xs: { name: string }[]) => xs.map((x) => x.name);

describe('sortEntries', () => {
  it('sorts by name naturally and case-insensitively', () => {
    const r = sortEntries(folders, files, { key: 'name', direction: 'asc' });
    expect(names(r.folders)).toEqual(['Alpha', 'beta', 'zeta']);
    expect(names(r.files)).toEqual(['a.txt', 'b.txt', 'File2.txt', 'file10.txt']);
  });

  it('reverses folders and files when sorting by name descending', () => {
    const r = sortEntries(folders, files, { key: 'name', direction: 'desc' });
    expect(names(r.folders)).toEqual(['zeta', 'beta', 'Alpha']);
    expect(names(r.files)).toEqual(['file10.txt', 'File2.txt', 'b.txt', 'a.txt']);
  });

  it('sorts files by size with name as tie-breaker, folders stay by name', () => {
    const asc = sortEntries(folders, files, { key: 'size', direction: 'asc' });
    expect(names(asc.files)).toEqual(['b.txt', 'File2.txt', 'a.txt', 'file10.txt']);
    expect(names(asc.folders)).toEqual(['Alpha', 'beta', 'zeta']);

    const desc = sortEntries(folders, files, { key: 'size', direction: 'desc' });
    expect(names(desc.files)).toEqual(['file10.txt', 'a.txt', 'b.txt', 'File2.txt']);
    expect(names(desc.folders)).toEqual(['Alpha', 'beta', 'zeta']);
  });

  it('sorts files by last modified, keeping undated entries last', () => {
    const asc = sortEntries([], files, { key: 'lastModified', direction: 'asc' });
    expect(names(asc.files)).toEqual(['File2.txt', 'b.txt', 'file10.txt', 'a.txt']);

    const desc = sortEntries([], files, { key: 'lastModified', direction: 'desc' });
    expect(names(desc.files)).toEqual(['file10.txt', 'b.txt', 'File2.txt', 'a.txt']);
  });

  it('does not mutate its inputs', () => {
    const input = [...files];
    sortEntries([], input, { key: 'size', direction: 'desc' });
    expect(input).toEqual(files);
  });
});

describe('nextSort', () => {
  it('toggles direction on the active column', () => {
    expect(nextSort(DEFAULT_SORT, 'name')).toEqual({ key: 'name', direction: 'desc' });
    expect(nextSort({ key: 'name', direction: 'desc' }, 'name')).toEqual({ key: 'name', direction: 'asc' });
  });

  it('starts ascending on a new column', () => {
    expect(nextSort({ key: 'name', direction: 'desc' }, 'size')).toEqual({ key: 'size', direction: 'asc' });
  });
});
