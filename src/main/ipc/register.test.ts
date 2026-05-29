import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, ListBucketsCommand, GetObjectCommand, GetBucketCorsCommand, GetObjectLockConfigurationCommand } from '@aws-sdk/client-s3';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { vi } from 'vitest';
import { registerIpc, type IpcMainLike } from './register';
import { CH, UPLOAD_PROGRESS_CHANNEL } from './channels';
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
  const progressEvents: { channel: string; payload: unknown }[] = [];
  const ipcMain: IpcMainLike = {
    handle: (channel, listener) =>
      handlers.set(channel, (...a) =>
        listener({ sender: { send: (c: string, p: unknown) => progressEvents.push({ channel: c, payload: p }) } }, ...a),
      ),
  };
  const db = openDatabase(':memory:');
  const deps = {
    accounts: createAccountsRepo(db),
    secrets: createSecretsStore(db, fakeCrypto),
    settings: createSettingsRepo(db),
    crypto: fakeCrypto,
    db,
    saveDialog: vi.fn().mockResolvedValue(null),
  };
  registerIpc(ipcMain, deps);
  return { handlers, deps, progressEvents };
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
      saveDialog: vi.fn().mockResolvedValue(null),
    };
    registerIpc(ipcMain, deps);
    const res = (await handlers.get(CH.accountsCreate)!({
      label: 'X', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { ok: boolean };
    expect(res.ok).toBe(false);
    expect(deps.accounts.list()).toHaveLength(0); // rolled back
  });
});

describe('uploadObject handler progress', () => {
  it('uploads and emits a progress event carrying the uploadId', async () => {
    const { handlers, progressEvents } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(PutObjectCommand).resolves({});

    const dir = mkdtempSync(join(tmpdir(), 's3m-up-'));
    const file = join(dir, 'hello.txt');
    writeFileSync(file, 'hello world');

    const res = (await handlers.get(CH.uploadObject)!({
      accountId: created.data.id, bucket: 'b', key: 'hello.txt', filePath: file, uploadId: 'up-1',
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(progressEvents.every((e) => e.channel === UPLOAD_PROGRESS_CHANNEL)).toBe(true);
    expect(progressEvents.every((e) => (e.payload as { uploadId: string }).uploadId === 'up-1')).toBe(true);
  });
});

describe('downloadObject handler', () => {
  it('returns { path: null } and performs no download when the save dialog is cancelled', async () => {
    const { handlers, deps } = buildHarness();
    (deps.saveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };

    const res = (await handlers.get(CH.downloadObject)!({ accountId: created.data.id, bucket: 'b', key: 'x.txt' })) as {
      ok: boolean; data: { path: string | null };
    };
    expect(res).toEqual({ ok: true, data: { path: null } });
    expect(s3Mock.commandCalls(GetObjectCommand).length).toBe(0);
  });

  it('downloads to the chosen path when the dialog returns one', async () => {
    const { handlers, deps } = buildHarness();
    const dir = mkdtempSync(join(tmpdir(), 's3m-dl-'));
    const dest = join(dir, 'out.txt');
    (deps.saveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(dest);
    s3Mock.on(GetObjectCommand).resolves({ Body: Readable.from([Buffer.from('payload')]) as never });
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };

    const res = (await handlers.get(CH.downloadObject)!({ accountId: created.data.id, bucket: 'b', key: 'docs/out.txt' })) as {
      ok: boolean; data: { path: string | null };
    };
    expect(res).toEqual({ ok: true, data: { path: dest } });
    expect(readFileSync(dest, 'utf8')).toBe('payload');
    expect(deps.saveDialog).toHaveBeenCalledWith('out.txt');
  });
});

describe('CORS handlers', () => {
  it('s3:getBucketCors returns the bucket rules via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(GetBucketCorsCommand).resolves({
      CORSRules: [{ AllowedMethods: ['GET'], AllowedOrigins: ['*'] }],
    });

    const res = (await handlers.get(CH.getBucketCors)!({ accountId: created.data.id, bucket: 'b' })) as {
      ok: boolean; data: { allowedMethods: string[] }[];
    };
    expect(res.ok).toBe(true);
    expect(res.data[0].allowedMethods).toEqual(['GET']);
  });
});

describe('Object Lock handlers', () => {
  it('s3:getObjectLockConfig returns the bucket lock status via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(GetObjectLockConfigurationCommand).resolves({
      ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'GOVERNANCE', Days: 30 } } },
    });

    const res = (await handlers.get(CH.getObjectLockConfig)!({ accountId: created.data.id, bucket: 'b' })) as {
      ok: boolean; data: { enabled: boolean; defaultRetention: { days: number | null } | null };
    };
    expect(res.ok).toBe(true);
    expect(res.data.enabled).toBe(true);
    expect(res.data.defaultRetention?.days).toBe(30);
  });
});
