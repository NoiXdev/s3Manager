import { Database as WasmDatabase } from 'node-sqlite3-wasm';

// We use node-sqlite3-wasm (a WASM build of SQLite) so there is no native
// module to compile/rebuild against Electron's ABI. Its API differs from the
// better-sqlite3 surface the repositories expect (positional spread args,
// `pragma`/`transaction` helpers, Buffer-typed BLOBs), so this module adapts
// the WASM API to that surface. Repositories depend only on `DB`/`Stmt` below.

type BindValue = number | bigint | string | Uint8Array | boolean | null;

export interface Stmt {
  run(...args: BindValue[]): void;
  get(...args: BindValue[]): unknown;
  all(...args: BindValue[]): unknown[];
}

export interface DB {
  prepare(sql: string): Stmt;
  exec(sql: string): void;
  /** Returns a function that runs `fn` inside a single transaction. */
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

function bind(args: BindValue[]): BindValue[] | undefined {
  return args.length ? args : undefined;
}

// node-sqlite3-wasm returns BLOBs as Uint8Array; better-sqlite3 (and our
// secrets store + safeStorage) expect Node Buffers. Normalize on read.
function normalizeRow(row: Record<string, unknown> | null): unknown {
  if (row == null) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] =
      value instanceof Uint8Array && !Buffer.isBuffer(value)
        ? Buffer.from(value)
        : value;
  }
  return out;
}

export function openDatabase(filename: string): DB {
  const db = new WasmDatabase(filename === ':memory:' ? undefined : filename);
  db.run('PRAGMA foreign_keys = ON');
  migrate(db);
  return wrap(db);
}

function migrate(db: WasmDatabase): void {
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

function wrap(db: WasmDatabase): DB {
  return {
    prepare(sql: string): Stmt {
      return {
        run: (...args) => {
          db.run(sql, bind(args));
        },
        get: (...args) => normalizeRow(db.get(sql, bind(args)) as Record<string, unknown> | null),
        all: (...args) =>
          (db.all(sql, bind(args)) as Record<string, unknown>[]).map(normalizeRow),
      };
    },
    exec: (sql) => db.exec(sql),
    transaction<T>(fn: () => T): () => T {
      return () => {
        db.run('BEGIN');
        try {
          const result = fn();
          db.run('COMMIT');
          return result;
        } catch (e) {
          db.run('ROLLBACK');
          throw e;
        }
      };
    },
    close: () => db.close(),
  };
}
