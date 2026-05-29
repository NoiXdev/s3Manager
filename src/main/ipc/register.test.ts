import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { registerIpc, type IpcMainLike } from './register';
import { CH } from './channels';
import { openDatabase } from '../storage/db';
import { createAccountsRepo } from '../storage/accountsRepo';
import { createSecretsStore, type Crypto } from '../storage/secrets';
import { createSettingsRepo } from '../storage/settingsRepo';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

const fakeCrypto: Crypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString('utf8'),
};

function buildHarness() {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = {
    handle: (channel, listener) => handlers.set(channel, (...a) => listener({}, ...a)),
  };
  const db = openDatabase(':memory:');
  const deps = {
    accounts: createAccountsRepo(db),
    secrets: createSecretsStore(db, fakeCrypto),
    settings: createSettingsRepo(db),
    crypto: fakeCrypto,
    db,
  };
  registerIpc(ipcMain, deps);
  return { handlers, deps };
}

describe('registerIpc', () => {
  it('registers a handler for every channel', () => {
    const { handlers } = buildHarness();
    for (const channel of Object.values(CH)) {
      expect(handlers.has(channel)).toBe(true);
    }
  });

  it('accounts:create stores account + secret and returns the account', async () => {
    const { handlers, deps } = buildHarness();
    const res = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { ok: boolean; data: { id: string } };
    expect(res.ok).toBe(true);
    expect(deps.accounts.list()).toHaveLength(1);
    expect(deps.secrets.get(res.data.id)).toBe('SK');
  });

  it('s3:listBuckets uses the account client', async () => {
    const { handlers, deps } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(ListBucketsCommand).resolves({ Buckets: [{ Name: 'b1' }] });

    const res = (await handlers.get(CH.listBuckets)!(created.data.id)) as { ok: boolean; data: string[] };
    expect(res).toEqual({ ok: true, data: ['b1'] });
    void deps;
  });

  it('accounts:create rejects an unknown provider and persists nothing', async () => {
    const { handlers, deps } = buildHarness();
    const res = (await handlers.get(CH.accountsCreate)!({
      label: 'X', provider: 'gcs', region: 'r', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { ok: boolean; error?: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('InvalidProvider');
    expect(deps.accounts.list()).toHaveLength(0);
  });

  it('accounts:create is atomic — a secret failure rolls back the account', async () => {
    const handlers = new Map<string, (...a: unknown[]) => unknown>();
    const ipcMain = { handle: (c: string, l: (e: unknown, ...a: never[]) => unknown) => handlers.set(c, (...a: unknown[]) => l({}, ...(a as never[]))) };
    const db = openDatabase(':memory:');
    const brokenCrypto = { ...fakeCrypto, isEncryptionAvailable: () => false };
    const deps = {
      accounts: createAccountsRepo(db),
      secrets: createSecretsStore(db, brokenCrypto),
      settings: createSettingsRepo(db),
      crypto: brokenCrypto,
      db,
    };
    registerIpc(ipcMain, deps);
    const res = (await handlers.get(CH.accountsCreate)!({
      label: 'X', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { ok: boolean };
    expect(res.ok).toBe(false);
    expect(deps.accounts.list()).toHaveLength(0); // rolled back
  });
});
