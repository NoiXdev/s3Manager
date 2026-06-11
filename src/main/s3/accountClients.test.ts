import { describe, it, expect } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { createClientForAccount } from './accountClients';
import { openDatabase } from '../storage/db';
import { createAccountsRepo } from '../storage/accountsRepo';
import { createSecretsStore, type Crypto } from '../storage/secrets';

const fakeCrypto: Crypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString('utf8'),
};

function setup() {
  const db = openDatabase(':memory:');
  const accounts = createAccountsRepo(db);
  const secrets = createSecretsStore(db, fakeCrypto);
  return { accounts, secrets };
}

describe('createClientForAccount', () => {
  it('builds an S3Client from stored account + secret', () => {
    const { accounts, secrets } = setup();
    const acc = accounts.create({ label: 'h', provider: 'hetzner', endpoint: 'https://fsn1.your-objectstorage.com', region: 'fsn1', accessKeyId: 'AK', forcePathStyle: false });
    secrets.set(acc.id, 'SK');

    const client = createClientForAccount(acc.id, { accounts, secrets });
    expect(client).toBeInstanceOf(S3Client);
  });

  it('throws when the account is missing', () => {
    const { accounts, secrets } = setup();
    expect(() => createClientForAccount('nope', { accounts, secrets })).toThrow(/account/i);
  });

  it('throws when the secret is missing', () => {
    const { accounts, secrets } = setup();
    const acc = accounts.create({ label: 'h', provider: 'hetzner', endpoint: 'e', region: 'fsn1', accessKeyId: 'AK', forcePathStyle: false });
    expect(() => createClientForAccount(acc.id, { accounts, secrets })).toThrow(/secret/i);
  });
});
