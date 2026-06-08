import { describe, it, expect } from 'vitest';
import { openDatabase } from './db';

describe('openDatabase', () => {
  it('creates the accounts, app_settings, and account_secrets tables', () => {
    const db = openDatabase(':memory:');
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toContain('accounts');
    expect(tables).toContain('app_settings');
    expect(tables).toContain('account_secrets');
  });

  it('is idempotent — opening twice does not throw', () => {
    expect(() => {
      openDatabase(':memory:');
      openDatabase(':memory:');
    }).not.toThrow();
  });

  it('adds the force_path_style column to accounts', () => {
    const db = openDatabase(':memory:');
    const cols = (db.prepare('PRAGMA table_info(accounts)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('force_path_style');
  });
});
