import { describe, it, expect } from 'vitest';
import { readSettings, writeSettings } from './appSettings';

function fakeRepo() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => { m.set(k, v); } };
}

describe('readSettings', () => {
  it('returns the default expiry when unset', () => {
    expect(readSettings(fakeRepo())).toEqual({ presignExpirySeconds: 3600, theme: 'system', language: 'system' });
  });

  it('returns a valid stored value', () => {
    const repo = fakeRepo();
    repo.set('presignExpirySeconds', '86400');
    expect(readSettings(repo)).toEqual({ presignExpirySeconds: 86400, theme: 'system', language: 'system' });
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
    expect(out).toEqual({ presignExpirySeconds: 86400, theme: 'system', language: 'system' });
    expect(readSettings(repo)).toEqual({ presignExpirySeconds: 86400, theme: 'system', language: 'system' });
  });

  it('clamps to the [1, 604800] range', () => {
    const repo = fakeRepo();
    expect(writeSettings(repo, { presignExpirySeconds: 99999999 }).presignExpirySeconds).toBe(604800);
    expect(writeSettings(repo, { presignExpirySeconds: 0 }).presignExpirySeconds).toBe(1);
  });
});

describe('theme', () => {
  it('defaults to "system" when unset', () => {
    expect(readSettings(fakeRepo()).theme).toBe('system');
  });

  it('returns a valid stored theme', () => {
    const repo = fakeRepo();
    repo.set('theme', 'dark');
    expect(readSettings(repo).theme).toBe('dark');
  });

  it('falls back to "system" for an invalid stored theme', () => {
    const repo = fakeRepo();
    repo.set('theme', 'neon');
    expect(readSettings(repo).theme).toBe('system');
  });

  it('persists a valid theme and ignores an invalid one', () => {
    const repo = fakeRepo();
    expect(writeSettings(repo, { theme: 'light' }).theme).toBe('light');
    expect(writeSettings(repo, { theme: 'bogus' as never }).theme).toBe('light');
  });
});

describe('language', () => {
  it('defaults to "system" when unset', () => {
    expect(readSettings(fakeRepo()).language).toBe('system');
  });

  it('returns a valid stored language', () => {
    const repo = fakeRepo();
    repo.set('language', 'de');
    expect(readSettings(repo).language).toBe('de');
  });

  it('falls back to "system" for an invalid stored language', () => {
    const repo = fakeRepo();
    repo.set('language', 'klingon');
    expect(readSettings(repo).language).toBe('system');
  });

  it('persists a valid language and ignores an invalid one', () => {
    const repo = fakeRepo();
    expect(writeSettings(repo, { language: 'fr' }).language).toBe('fr');
    expect(writeSettings(repo, { language: 'bogus' as never }).language).toBe('fr');
  });
});
