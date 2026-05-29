import type { DB } from './db';

/** Subset of Electron's safeStorage we depend on (injectable for tests). */
export interface Crypto {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export function createSecretsStore(db: DB, crypto: Crypto) {
  return {
    set(accountId: string, secret: string): void {
      if (!crypto.isEncryptionAvailable()) {
        throw new Error('Secret encryption is not available on this system');
      }
      const ciphertext = crypto.encryptString(secret);
      db.prepare(
        `INSERT INTO account_secrets (account_id, ciphertext) VALUES (?, ?)
         ON CONFLICT(account_id) DO UPDATE SET ciphertext = excluded.ciphertext`,
      ).run(accountId, ciphertext);
    },
    get(accountId: string): string | undefined {
      const row = db
        .prepare('SELECT ciphertext FROM account_secrets WHERE account_id = ?')
        .get(accountId) as { ciphertext: Buffer } | undefined;
      if (!row) return undefined;
      return crypto.decryptString(row.ciphertext);
    },
    remove(accountId: string): void {
      db.prepare('DELETE FROM account_secrets WHERE account_id = ?').run(accountId);
    },
  };
}

export type SecretsStore = ReturnType<typeof createSecretsStore>;
