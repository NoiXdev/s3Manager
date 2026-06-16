import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, ListBucketsCommand, GetObjectCommand, GetBucketCorsCommand, GetObjectLockConfigurationCommand, ListObjectsV2Command, PutObjectAclCommand, GetObjectRetentionCommand, PutObjectLegalHoldCommand, GetObjectAclCommand, HeadObjectCommand, CopyObjectCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
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

function buildHarness(overrides: Record<string, unknown> = {}) {
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
    saveTextFile: vi.fn().mockResolvedValue(false),
    openTextFile: vi.fn().mockResolvedValue(null),
    appVersion: '1.2.3',
    openExternal: vi.fn().mockResolvedValue(undefined),
    ...overrides,
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

  it('util:saveTextFile delegates to the injected saveTextFile helper', async () => {
    const saveTextFile = vi.fn().mockResolvedValue(true);
    const { handlers } = buildHarness({ saveTextFile });
    const res = (await handlers.get(CH.saveTextFile)!({ defaultName: 'x.txt', contents: 'hi' })) as { ok: boolean; data: { saved: boolean } };
    expect(saveTextFile).toHaveBeenCalledWith('x.txt', 'hi');
    expect(res).toEqual({ ok: true, data: { saved: true } });
  });

  it('util:openTextFile delegates to the injected openTextFile helper', async () => {
    const openTextFile = vi.fn().mockResolvedValue('file-contents');
    const { handlers } = buildHarness({ openTextFile });
    const res = (await handlers.get(CH.openTextFile)!()) as { ok: boolean; data: string | null };
    expect(openTextFile).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: true, data: 'file-contents' });
  });

  it('shell:openExternal opens http(s) urls', async () => {
    const { handlers, deps } = buildHarness();
    const res = await handlers.get(CH.openExternal)!('https://github.com/facebook/react');
    expect(res).toEqual({ ok: true, data: true });
    expect(deps.openExternal).toHaveBeenCalledWith('https://github.com/facebook/react');
  });

  it('shell:openExternal rejects non-http schemes', async () => {
    const { handlers, deps } = buildHarness();
    const res = (await handlers.get(CH.openExternal)!('file:///etc/passwd')) as { ok: boolean };
    expect(res.ok).toBe(false);
    expect(deps.openExternal).not.toHaveBeenCalled();
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

  it('accounts:update changes fields and keeps the secret when none is given', async () => {
    const { handlers, deps } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };

    const res = (await handlers.get(CH.accountsUpdate)!({
      id: created.data.id, label: 'AWS renamed', provider: 'amazon-s3',
      region: 'us-east-1', accessKeyId: 'AK2',
    })) as { ok: boolean; data: { label: string; region: string } };

    expect(res.ok).toBe(true);
    expect(res.data.label).toBe('AWS renamed');
    expect(deps.accounts.get(created.data.id)?.region).toBe('us-east-1');
    expect(deps.secrets.get(created.data.id)).toBe('SK'); // unchanged
  });

  it('accounts:update replaces the secret when one is provided', async () => {
    const { handlers, deps } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };

    await handlers.get(CH.accountsUpdate)!({
      id: created.data.id, label: 'AWS', provider: 'amazon-s3',
      region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'NEWSECRET',
    });

    expect(deps.secrets.get(created.data.id)).toBe('NEWSECRET');
  });

  it('accounts:update rejects an unknown provider', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.accountsUpdate)!({
      id: 'x', label: 'L', provider: 'nope', region: 'r', accessKeyId: 'AK',
    })) as { ok: boolean; error: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('InvalidProvider');
  });

  it('accounts:update keeps the stored secret when given an empty-string secret', async () => {
    const { handlers, deps } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };

    await handlers.get(CH.accountsUpdate)!({
      id: created.data.id, label: 'AWS', provider: 'amazon-s3',
      region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: '',
    });

    expect(deps.secrets.get(created.data.id)).toBe('SK'); // empty string does not overwrite
  });

  it('accounts:update returns AccountNotFound for an unknown id', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.accountsUpdate)!({
      id: 'missing', label: 'L', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK',
    })) as { ok: boolean; error: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('AccountNotFound');
  });

  it('accounts:update re-resolves endpoint and forcePathStyle on a provider switch', async () => {
    const { handlers, deps } = buildHarness();
    // start as a custom provider with an explicit endpoint + path-style
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'MinIO', provider: 'custom', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
      endpoint: 'https://minio.example.com:9000', forcePathStyle: true,
    })) as { data: { id: string; endpoint?: string; forcePathStyle: boolean } };
    expect(created.data.endpoint).toBe('https://minio.example.com:9000');
    expect(created.data.forcePathStyle).toBe(true);

    // switch to amazon-s3: endpoint should be cleared, forcePathStyle reset to the provider default (false)
    const updated = (await handlers.get(CH.accountsUpdate)!({
      id: created.data.id, label: 'MinIO', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK',
    })) as { ok: boolean; data: { endpoint?: string; forcePathStyle: boolean } };

    expect(updated.ok).toBe(true);
    expect(updated.data.endpoint).toBeUndefined();
    expect(updated.data.forcePathStyle).toBe(false);
    // persisted, not just returned
    const stored = deps.accounts.get(created.data.id);
    expect(stored?.endpoint).toBeUndefined();
    expect(stored?.forcePathStyle).toBe(false);
  });

  it('accounts:test uses the stored secret when given an id and no secret', async () => {
    const { handlers, deps } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'STORED',
    })) as { data: { id: string } };
    s3Mock.on(ListBucketsCommand).resolves({ Buckets: [] });

    const res = (await handlers.get(CH.accountsTest)!({
      id: created.data.id, label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK',
    })) as { ok: boolean };

    expect(res.ok).toBe(true); // did not throw for a missing secret
  });

  it('accounts:create persists forcePathStyle derived from the provider', async () => {
    const { handlers, deps } = buildHarness();
    const aws = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string; forcePathStyle: boolean } };
    expect(aws.data.forcePathStyle).toBe(false);
    expect(deps.accounts.get(aws.data.id)?.forcePathStyle).toBe(false); // read back from the DB

    const hz = (await handlers.get(CH.accountsCreate)!({
      label: 'HZ', provider: 'hetzner', region: 'fsn1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string; forcePathStyle: boolean } };
    expect(hz.data.forcePathStyle).toBe(true);
    expect(deps.accounts.get(hz.data.id)?.forcePathStyle).toBe(true); // read back from the DB
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

  it('accounts:export returns a string that imports back to the account incl. secret', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SECRET',
    })) as { ok: true; data: { id: string } };
    const res = (await handlers.get(CH.accountsExport)!({ accountIds: [created.data.id] })) as { ok: boolean; data: string };
    expect(res.ok).toBe(true);
    const { importAccounts } = await import('../accounts/accountTransfer');
    expect(importAccounts(res.data)).toEqual([
      { label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SECRET', endpoint: undefined, forcePathStyle: false },
    ]);
  });

  it('accounts:import creates the accounts and their secrets', async () => {
    const { exportAccounts } = await import('../accounts/accountTransfer');
    const blob = exportAccounts([
      { label: 'Imported', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'IK', secretAccessKey: 'IS' },
    ]);
    const { handlers, deps } = buildHarness();
    const res = (await handlers.get(CH.accountsImport)!({ blob })) as { ok: boolean; data: { id: string }[] };
    expect(res.ok).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(deps.accounts.list().map((a) => a.label)).toContain('Imported');
    expect(deps.secrets.get(res.data[0].id)).toBe('IS');
  });

  it('accounts:import rejects an unknown provider without creating anything', async () => {
    const { exportAccounts } = await import('../accounts/accountTransfer');
    const blob = exportAccounts([
      { label: 'Bad', provider: 'not-a-provider' as never, region: 'x', accessKeyId: 'K', secretAccessKey: 'S' },
    ]);
    const { handlers, deps } = buildHarness();
    const res = (await handlers.get(CH.accountsImport)!({ blob })) as { ok: boolean };
    expect(res.ok).toBe(false);
    expect(deps.accounts.list()).toHaveLength(0);
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
      saveTextFile: vi.fn().mockResolvedValue(false),
      openTextFile: vi.fn().mockResolvedValue(null),
      appVersion: '1.2.3',
      openExternal: vi.fn().mockResolvedValue(undefined),
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

describe('retention & legal hold handlers', () => {
  it('s3:getObjectRetention returns none when unset', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(GetObjectRetentionCommand).rejects(Object.assign(new Error('none'), { name: 'NoSuchObjectLockConfiguration' }));

    const res = (await handlers.get(CH.getObjectRetention)!({ accountId: created.data.id, bucket: 'b', key: 'k' })) as {
      ok: boolean; data: { mode: string | null; retainUntil: string | null };
    };
    expect(res).toEqual({ ok: true, data: { mode: null, retainUntil: null } });
  });

  it('s3:putObjectLegalHold sets the hold via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(PutObjectLegalHoldCommand).resolves({});

    const res = (await handlers.get(CH.putObjectLegalHold)!({ accountId: created.data.id, bucket: 'b', key: 'k', status: 'ON' })) as {
      ok: boolean; data: boolean;
    };
    expect(res).toEqual({ ok: true, data: true });
  });
});

describe('settings & app info handlers', () => {
  it('settings:get returns the default and settings:set persists a new value', async () => {
    const { handlers } = buildHarness();
    const before = (await handlers.get(CH.getSettings)!()) as { ok: boolean; data: { presignExpirySeconds: number } };
    expect(before).toEqual({ ok: true, data: { presignExpirySeconds: 3600, theme: 'system', language: 'system', autoCheckUpdates: true, lastUpdateCheckAt: null } });

    const saved = (await handlers.get(CH.setSettings)!({ presignExpirySeconds: 86400 })) as { ok: boolean; data: { presignExpirySeconds: number } };
    expect(saved.data.presignExpirySeconds).toBe(86400);

    const after = (await handlers.get(CH.getSettings)!()) as { ok: boolean; data: { presignExpirySeconds: number } };
    expect(after.data.presignExpirySeconds).toBe(86400);
  });

  it('app:getInfo returns version, encryption status, and account count', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.getAppInfo)!()) as {
      ok: boolean; data: { version: string; encryptionAvailable: boolean; accountCount: number };
    };
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ version: '1.2.3', encryptionAvailable: true, accountCount: 0 });
  });

  it('app:checkForUpdate reports a newer release as available', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ tag_name: 'v9.9.9', html_url: 'https://example/release' }),
    });
    const { handlers } = buildHarness({ fetchImpl });
    const res = (await handlers.get(CH.checkForUpdate)!()) as {
      ok: boolean;
      data: { updateAvailable: boolean; latestVersion: string };
    };
    expect(res.ok).toBe(true);
    expect(res.data.updateAvailable).toBe(true);
    expect(res.data.latestVersion).toBe('9.9.9');
  });
});

describe('object ACL handlers', () => {
  it('s3:getObjectAcl returns the mapped ACL via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(GetObjectAclCommand).resolves({
      Owner: { ID: 'o', DisplayName: 'me' },
      Grants: [{ Grantee: { Type: 'CanonicalUser', ID: 'o', DisplayName: 'me' }, Permission: 'FULL_CONTROL' }],
    });

    const res = (await handlers.get(CH.getObjectAcl)!({ accountId: created.data.id, bucket: 'b', key: 'k' })) as {
      ok: boolean; data: { owner: { id: string }; grants: unknown[] };
    };
    expect(res.ok).toBe(true);
    expect(res.data.owner.id).toBe('o');
    expect(res.data.grants).toHaveLength(1);
  });

  it('s3:putObjectAcl writes the ACL via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(PutObjectAclCommand).resolves({});

    const res = (await handlers.get(CH.putObjectAcl)!({
      accountId: created.data.id, bucket: 'b', key: 'k',
      acl: { owner: { id: 'o', displayName: 'me' }, grants: [] },
    })) as { ok: boolean; data: boolean };
    expect(res).toEqual({ ok: true, data: true });
  });
});

describe('metadata edit handlers', () => {
  it('s3:getEditableMetadata returns the mapped fields via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(HeadObjectCommand).resolves({ ContentType: 'text/plain', CacheControl: 'no-cache', ContentDisposition: 'inline', Metadata: { a: '1' } });
    const res = (await handlers.get(CH.getEditableMetadata)!({ accountId: created.data.id, bucket: 'b', key: 'k' })) as {
      ok: boolean; data: { contentType: string | null; cacheControl: string | null; contentDisposition: string | null; metadata: Record<string, string> };
    };
    expect(res.ok).toBe(true);
    expect(res.data.contentType).toBe('text/plain');
    expect(res.data.cacheControl).toBe('no-cache');
    expect(res.data.contentDisposition).toBe('inline');
    expect(res.data.metadata).toEqual({ a: '1' });
  });

  it('s3:updateObjectMetadata applies the metadata changes via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(HeadObjectCommand).resolves({});
    s3Mock.on(CopyObjectCommand).resolves({});
    const res = (await handlers.get(CH.updateObjectMetadata)!({
      accountId: created.data.id, bucket: 'b', key: 'k',
      contentType: 'application/json', cacheControl: null, contentDisposition: null, metadata: {},
    })) as { ok: boolean; data: boolean };
    expect(res).toEqual({ ok: true, data: true });
    const input = s3Mock.commandCalls(CopyObjectCommand)[0].args[0].input;
    expect(input.MetadataDirective).toBe('REPLACE');
    expect(input.Bucket).toBe('b');
    expect(input.Key).toBe('k');
    expect(input.ContentType).toBe('application/json');
  });
});

describe('create bucket handler', () => {
  it('creates a bucket in the account region and returns ok', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(CreateBucketCommand).resolves({});

    const res = (await handlers.get(CH.createBucket)!({
      accountId: created.data.id, bucket: 'new-bucket', objectLock: false, versioning: false,
    })) as { ok: boolean; data: boolean };
    expect(res).toEqual({ ok: true, data: true });
    const input = s3Mock.commandCalls(CreateBucketCommand)[0].args[0].input;
    expect(input.Bucket).toBe('new-bucket');
    expect(input.CreateBucketConfiguration).toEqual({ LocationConstraint: 'eu-central-1' });
  });

  it('returns an error result for an unknown account', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.createBucket)!({
      accountId: 'nope', bucket: 'b', objectLock: false, versioning: false,
    })) as { ok: boolean };
    expect(res.ok).toBe(false);
  });
});

describe('custom provider', () => {
  it('accounts:create stores the typed endpoint and path-style toggle', async () => {
    const { handlers, deps } = buildHarness();
    const res = (await handlers.get(CH.accountsCreate)!({
      label: 'MinIO', provider: 'custom', region: 'us-east-1',
      endpoint: 'https://minio.example.com:9000', forcePathStyle: true,
      accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { ok: boolean; data: { endpoint?: string; forcePathStyle: boolean } };
    expect(res.ok).toBe(true);
    expect(res.data.endpoint).toBe('https://minio.example.com:9000');
    expect(res.data.forcePathStyle).toBe(true);
    expect(deps.accounts.list()).toHaveLength(1);
  });

  it('accounts:create honors forcePathStyle=false for a custom host', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.accountsCreate)!({
      label: 'Custom', provider: 'custom', region: 'us-east-1',
      endpoint: 'https://s3.example.com', forcePathStyle: false,
      accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { forcePathStyle: boolean } };
    expect(res.data.forcePathStyle).toBe(false);
  });

  it('accounts:create rejects a custom provider with a missing/invalid endpoint and persists nothing', async () => {
    const { handlers, deps } = buildHarness();
    const res = (await handlers.get(CH.accountsCreate)!({
      label: 'Bad', provider: 'custom', region: 'us-east-1',
      endpoint: 'not-a-url', forcePathStyle: true,
      accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { ok: boolean; error?: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('InvalidEndpoint');
    expect(deps.accounts.list()).toHaveLength(0);
  });

  it('accounts:test succeeds against a custom endpoint', async () => {
    const { handlers } = buildHarness();
    s3Mock.on(ListBucketsCommand).resolves({ Buckets: [{ Name: 'b1' }] });
    const res = (await handlers.get(CH.accountsTest)!({
      label: 'MinIO', provider: 'custom', region: 'us-east-1',
      endpoint: 'https://minio.example.com:9000', forcePathStyle: true,
      accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
  });

  it('accounts:test rejects a custom provider with an invalid endpoint', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.accountsTest)!({
      label: 'Bad', provider: 'custom', region: 'us-east-1',
      endpoint: '', forcePathStyle: true,
      accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { ok: boolean; error?: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('InvalidEndpoint');
  });

  it('accounts:create defaults forcePathStyle to true when omitted for a custom host', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.accountsCreate)!({
      label: 'MinIO', provider: 'custom', region: 'us-east-1',
      endpoint: 'https://minio.example.com:9000',
      accessKeyId: 'AK', secretAccessKey: 'SK',
      // forcePathStyle intentionally omitted
    })) as { data: { forcePathStyle: boolean } };
    expect(res.data.forcePathStyle).toBe(true);
  });

  it('accounts:create rejects a custom endpoint with a non-http(s) protocol', async () => {
    const { handlers, deps } = buildHarness();
    const res = (await handlers.get(CH.accountsCreate)!({
      label: 'FTP', provider: 'custom', region: 'us-east-1',
      endpoint: 'ftp://files.example.com', forcePathStyle: true,
      accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { ok: boolean; error?: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('InvalidEndpoint');
    expect(deps.accounts.list()).toHaveLength(0);
  });
});
