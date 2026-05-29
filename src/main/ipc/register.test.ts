import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, ListBucketsCommand, GetObjectCommand, GetBucketCorsCommand, GetObjectLockConfigurationCommand, ListObjectsV2Command, PutObjectAclCommand } from '@aws-sdk/client-s3';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { vi } from 'vitest';
import { registerIpc, type IpcMainLike } from './register';
import { CH, UPLOAD_PROGRESS_CHANNEL, SYNC_PROGRESS_CHANNEL } from './channels';
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
    selectDirectory: vi.fn().mockResolvedValue('/picked/dir'),
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
      selectDirectory: vi.fn().mockResolvedValue('/picked/dir'),
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

describe('transfer handlers', () => {
  it('s3:createFolder creates the folder marker via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(PutObjectCommand).resolves({});
    const res = (await handlers.get(CH.createFolder)!({ accountId: created.data.id, bucket: 'b', prefix: 'p/', name: 'new' })) as {
      ok: boolean; data: { key: string };
    };
    expect(res).toEqual({ ok: true, data: { key: 'p/new/' } });
  });
});

describe('sync handlers', () => {
  it('sync:plan diffs source vs destination via the account clients', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(ListObjectsV2Command, { Bucket: 'b', Prefix: 'a/' }).resolves({ Contents: [{ Key: 'a/one.txt', Size: 10 }] });
    s3Mock.on(ListObjectsV2Command, { Bucket: 'b', Prefix: 'dst/' }).resolves({ Contents: [] });

    const res = (await handlers.get(CH.syncPlan)!({
      source: { accountId: created.data.id, bucket: 'b', prefix: 'a/' },
      dest: { accountId: created.data.id, bucket: 'b', prefix: 'dst/' },
    })) as { ok: boolean; data: { toCopy: number; bytesToCopy: number } };
    expect(res.ok).toBe(true);
    expect(res.data.toCopy).toBe(1);
    expect(res.data.bytesToCopy).toBe(10);
  });

  it('sync:cancel returns ok even when nothing is running', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.syncCancel)!()) as { ok: boolean; data: boolean };
    expect(res).toEqual({ ok: true, data: true });
  });
});

describe('local sync handlers', () => {
  it('sync:localPlan diffs a local directory against the bucket', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    const dir = mkdtempSync(join(tmpdir(), 's3m-lp-'));
    writeFileSync(join(dir, 'a.txt'), 'hello');
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });

    const res = (await handlers.get(CH.localSyncPlan)!({
      direction: 'upload', localPath: dir, remote: { accountId: created.data.id, bucket: 'b', prefix: '' },
    })) as { ok: boolean; data: { toCopy: number } };
    expect(res.ok).toBe(true);
    expect(res.data.toCopy).toBe(1);
  });

  it('sync:selectDirectory returns the chosen path from the dialog dep', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.selectDirectory)!()) as { ok: boolean; data: string | null };
    expect(res).toEqual({ ok: true, data: '/picked/dir' });
  });

  it('sync:localRun uploads the local dir and emits progress on the sync channel', async () => {
    const { handlers, progressEvents } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    const dir = mkdtempSync(join(tmpdir(), 's3m-lr-'));
    writeFileSync(join(dir, 'a.txt'), 'hello');
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    s3Mock.on(PutObjectCommand).resolves({});

    const res = (await handlers.get(CH.localSyncRun)!({
      direction: 'upload', localPath: dir, remote: { accountId: created.data.id, bucket: 'b', prefix: '' },
    })) as { ok: boolean; data: { copied: number } };
    expect(res.ok).toBe(true);
    expect(res.data.copied).toBe(1);
    expect(progressEvents.some((e) => e.channel === SYNC_PROGRESS_CHANNEL)).toBe(true);
  });
});

describe('presignPut handler', () => {
  it('s3:presignPut returns a signed upload URL via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };

    const res = (await handlers.get(CH.presignPut)!({
      accountId: created.data.id, bucket: 'b', key: 'k.txt', expiresIn: 86400,
    })) as { ok: boolean; data: string };
    expect(res.ok).toBe(true);
    expect(res.data).toMatch(/^https:\/\//);
    expect(res.data).toContain('X-Amz-Expires=86400');
  });
});

describe('setObjectVisibility handler', () => {
  it('s3:setObjectVisibility sets the ACL via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(PutObjectAclCommand).resolves({});

    const res = (await handlers.get(CH.setObjectVisibility)!({
      accountId: created.data.id, bucket: 'b', key: 'k', visibility: 'public',
    })) as { ok: boolean; data: string };
    expect(res).toEqual({ ok: true, data: 'public' });
  });
});
