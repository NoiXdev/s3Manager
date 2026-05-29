import { describe, it, expect } from 'vitest';
import { openDatabase, type DB } from './db';
import { createSecretsStore, type Crypto } from './secrets';

// Fake safeStorage: reversible "encryption" for tests.
const fakeCrypto: Crypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
  decryptString: (b) => b.toString('utf8').replace(/^enc:/, ''),
};

function seedAccount(db: DB, id: string): void {
  db.prepare(
    `INSERT INTO accounts (id, label, provider, endpoint, region, access_key_id, created_at)
     VALUES (?, 'L', 'amazon-s3', NULL, 'eu-central-1', 'AK', 0)`,
  ).run(id);
}

describe('secretsStore', () => {
  it('stores and retrieves a secret via ciphertext, never plaintext in the row', () => {
    const db = openDatabase(':memory:');
    seedAccount(db, 'acc-1');
    const store = createSecretsStore(db, fakeCrypto);
    store.set('acc-1', 'super-secret');

    const row = db.prepare('SELECT ciphertext FROM account_secrets WHERE account_id = ?').get('acc-1') as {
      ciphertext: Buffer;
    };
    expect(row.ciphertext.toString('utf8')).toBe('enc:super-secret'); // encrypted, not raw
    expect(store.get('acc-1')).toBe('super-secret');
  });

  it('returns undefined for unknown account', () => {
    const store = createSecretsStore(openDatabase(':memory:'), fakeCrypto);
    expect(store.get('nope')).toBeUndefined();
  });

  it('removes a secret', () => {
    const db = openDatabase(':memory:');
    seedAccount(db, 'acc-1');
    const store = createSecretsStore(db, fakeCrypto);
    store.set('acc-1', 'x');
    store.remove('acc-1');
    expect(store.get('acc-1')).toBeUndefined();
  });

  it('throws on set when encryption is unavailable', () => {
    const store = createSecretsStore(openDatabase(':memory:'), { ...fakeCrypto, isEncryptionAvailable: () => false });
    expect(() => store.set('acc-1', 'x')).toThrow(/encryption/i);
  });
});
