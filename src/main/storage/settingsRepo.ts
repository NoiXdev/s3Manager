import type { DB } from './db';

export function createSettingsRepo(db: DB) {
  return {
    get(key: string): string | undefined {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
        | { value: string }
        | undefined;
      return row?.value;
    },
    set(key: string, value: string): void {
      db.prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(key, value);
    },
  };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
