import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { walkDir, contentTypeFor } from './localSync';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 's3m-walk-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('walkDir', () => {
  it('returns regular files with normalized relKeys and sizes', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello'); // 5 bytes
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'b.txt'), 'hi'); // 2 bytes
    const out = (await walkDir(dir)).sort((x, y) => x.relKey.localeCompare(y.relKey));
    expect(out).toEqual([
      { relKey: 'a.txt', size: 5 },
      { relKey: 'sub/b.txt', size: 2 },
    ]);
  });

  it('returns an empty array for an empty directory', async () => {
    expect(await walkDir(dir)).toEqual([]);
  });
});

describe('contentTypeFor', () => {
  it('maps known extensions and returns undefined otherwise', () => {
    expect(contentTypeFor('logo.png')).toBe('image/png');
    expect(contentTypeFor('a/b/style.css')).toBe('text/css');
    expect(contentTypeFor('data.unknownext')).toBeUndefined();
    expect(contentTypeFor('noext')).toBeUndefined();
  });
});
