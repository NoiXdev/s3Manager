import { describe, it, expect } from 'vitest';
import { transformListing, prefixToBreadcrumb, parentPrefix } from './listTransform';

describe('transformListing', () => {
  it('maps CommonPrefixes to folders and Contents to files, skipping the prefix placeholder', () => {
    const out = transformListing(
      {
        CommonPrefixes: [{ Prefix: 'images/thumbs/' }],
        Contents: [
          { Key: 'images/', Size: 0 }, // the folder placeholder key — must be skipped
          { Key: 'images/logo.png', Size: 1234, LastModified: new Date('2024-01-01'), StorageClass: 'STANDARD', ETag: '"abc"' },
        ],
      },
      'images/',
    );
    expect(out.folders).toEqual([{ name: 'thumbs', prefix: 'images/thumbs/' }]);
    expect(out.files).toEqual([
      {
        name: 'logo.png',
        key: 'images/logo.png',
        size: 1234,
        lastModified: '2024-01-01T00:00:00.000Z',
        storageClass: 'STANDARD',
        etag: '"abc"',
      },
    ]);
  });
});

describe('prefixToBreadcrumb', () => {
  it('returns root for empty prefix', () => {
    expect(prefixToBreadcrumb('')).toEqual([{ label: 'root', prefix: '' }]);
  });
  it('builds cumulative segments', () => {
    expect(prefixToBreadcrumb('a/b/')).toEqual([
      { label: 'root', prefix: '' },
      { label: 'a', prefix: 'a/' },
      { label: 'b', prefix: 'a/b/' },
    ]);
  });
});

describe('parentPrefix', () => {
  it('drops the last segment', () => {
    expect(parentPrefix('a/b/')).toBe('a/');
    expect(parentPrefix('a/')).toBe('');
    expect(parentPrefix('')).toBe('');
  });
});
