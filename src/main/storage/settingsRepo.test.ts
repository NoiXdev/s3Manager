import { describe, it, expect } from 'vitest';
import { openDatabase } from './db';
import { createSettingsRepo } from './settingsRepo';

describe('settingsRepo', () => {
  it('returns undefined for missing keys', () => {
    const repo = createSettingsRepo(openDatabase(':memory:'));
    expect(repo.get('theme')).toBeUndefined();
  });

  it('sets and gets a value, and upserts on repeat', () => {
    const repo = createSettingsRepo(openDatabase(':memory:'));
    repo.set('theme', 'dark');
    expect(repo.get('theme')).toBe('dark');
    repo.set('theme', 'light');
    expect(repo.get('theme')).toBe('light');
  });
});
