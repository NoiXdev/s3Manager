import { describe, it, expect } from 'vitest';
import { readSettings, writeSettings } from './appSettings';

function fakeRepo() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => { m.set(k, v); } };
}

describe('readSettings', () => {
  it('returns the default expiry when unset', () => {
    expect(readSettings(fakeRepo())).toEqual({ presignExpirySeconds: 3600 });
  });

  it('returns a valid stored value', () => {
    const repo = fakeRepo();
    repo.set('presignExpirySeconds', '86400');
    expect(readSettings(repo)).toEqual({ presignExpirySeconds: 86400 });
  });

  it('falls back to the default for a non-numeric or out-of-range stored value', () => {
    const repo = fakeRepo();
    repo.set('presignExpirySeconds', 'nonsense');
    expect(readSettings(repo).presignExpirySeconds).toBe(3600);
    repo.set('presignExpirySeconds', '99999999');
    expect(readSettings(repo).presignExpirySeconds).toBe(3600);
  });
});

describe('writeSettings', () => {
  it('persists a value and returns the merged settings', () => {
    const repo = fakeRepo();
    const out = writeSettings(repo, { presignExpirySeconds: 86400 });
    expect(out).toEqual({ presignExpirySeconds: 86400 });
    expect(readSettings(repo)).toEqual({ presignExpirySeconds: 86400 });
  });

  it('clamps to the [1, 604800] range', () => {
    const repo = fakeRepo();
    expect(writeSettings(repo, { presignExpirySeconds: 99999999 }).presignExpirySeconds).toBe(604800);
    expect(writeSettings(repo, { presignExpirySeconds: 0 }).presignExpirySeconds).toBe(1);
  });
});
