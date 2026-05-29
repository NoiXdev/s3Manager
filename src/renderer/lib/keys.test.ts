import { describe, it, expect } from 'vitest';
import { parentPrefix, baseName } from './keys';

describe('baseName', () => {
  it('returns the final segment for files, folders, and top-level items', () => {
    expect(baseName('images/logo.png')).toBe('logo.png');
    expect(baseName('images/old/')).toBe('old');
    expect(baseName('logo.png')).toBe('logo.png');
    expect(baseName('old/')).toBe('old');
  });
});

describe('parentPrefix', () => {
  it('returns the prefix up to the final segment', () => {
    expect(parentPrefix('images/logo.png')).toBe('images/');
    expect(parentPrefix('images/old/')).toBe('images/');
    expect(parentPrefix('logo.png')).toBe('');
    expect(parentPrefix('old/')).toBe('');
  });
});
