import Database from 'better-sqlite3';

export type DB = Database.Database;

export function openDatabase(filename: string): DB {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            TEXT PRIMARY KEY,
      label         TEXT NOT NULL,
      provider      TEXT NOT NULL,
      endpoint      TEXT,
      region        TEXT NOT NULL,
      access_key_id TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_secrets (
      account_id TEXT PRIMARY KEY,
      ciphertext BLOB NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
  `);
}
