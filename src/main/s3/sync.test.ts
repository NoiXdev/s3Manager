import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, ListObjectsV2Command, CopyObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { listAll, planSync, runSync } from './sync';
import { Readable } from 'node:stream';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('listAll', () => {
  it('paginates, strips the prefix, and skips the folder marker equal to the prefix', async () => {
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({ Contents: [{ Key: 'p/', Size: 0 }, { Key: 'p/a.txt', Size: 10 }], NextContinuationToken: 'T' })
      .resolves({ Contents: [{ Key: 'p/sub/b.txt', Size: 20 }] });
    const out = await listAll(new S3Client({}), 'bucket', 'p/');
    expect(out).toEqual([
      { relKey: 'a.txt', size: 10 },
      { relKey: 'sub/b.txt', size: 20 },
    ]);
  });
});

describe('planSync', () => {
  it('summarizes objects to copy vs up-to-date and totals the bytes', async () => {
    s3Mock.on(ListObjectsV2Command, { Bucket: 'src', Prefix: 'a/' }).resolves({
      Contents: [{ Key: 'a/one.txt', Size: 100 }, { Key: 'a/two.txt', Size: 50 }],
    });
    s3Mock.on(ListObjectsV2Command, { Bucket: 'dst', Prefix: 'b/' }).resolves({
      Contents: [{ Key: 'b/two.txt', Size: 50 }],
    });
    const r = await planSync(
      new S3Client({}),
      new S3Client({}),
      { accountId: 'acc', bucket: 'src', prefix: 'a/' },
      { accountId: 'acc', bucket: 'dst', prefix: 'b/' },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.toCopy).toBe(1);
      expect(r.data.upToDate).toBe(1);
      expect(r.data.bytesToCopy).toBe(100);
      expect(r.data.sample).toEqual([{ relKey: 'one.txt', size: 100, reason: 'missing' }]);
    }
  });

  it('returns an error Result when listing fails', async () => {
    s3Mock.on(ListObjectsV2Command).rejects(new Error('AccessDenied'));
    const r = await planSync(
      new S3Client({}),
      new S3Client({}),
      { accountId: 'a', bucket: 'src', prefix: '' },
      { accountId: 'a', bucket: 'dst', prefix: '' },
    );
    expect(r.ok).toBe(false);
  });
});

describe('runSync', () => {
  const source = { accountId: 'a', bucket: 'src', prefix: 'a/' };
  const dest = { accountId: 'a', bucket: 'dst', prefix: 'b/' };

  function listings() {
    s3Mock.on(ListObjectsV2Command, { Bucket: 'src', Prefix: 'a/' }).resolves({ Contents: [{ Key: 'a/one.txt', Size: 4 }] });
    s3Mock.on(ListObjectsV2Command, { Bucket: 'dst', Prefix: 'b/' }).resolves({ Contents: [] });
  }

  it('same-account copies use server-side CopyObject (no GetObject)', async () => {
    listings();
    s3Mock.on(CopyObjectCommand).resolves({});
    const r = await runSync(new S3Client({}), new S3Client({}), source, dest, { sameAccount: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toMatchObject({ copied: 1, bytesCopied: 4, failed: [], canceled: false });
    const copy = s3Mock.commandCalls(CopyObjectCommand)[0].args[0].input;
    expect(copy.Bucket).toBe('dst');
    expect(copy.CopySource).toBe('src/a/one.txt');
    expect(copy.Key).toBe('b/one.txt');
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it('cross-account copies stream GetObject -> Upload (PutObject), not CopyObject', async () => {
    listings();
    s3Mock.on(GetObjectCommand).resolves({ Body: Readable.from(Buffer.from('data')) as never, ContentType: 'text/plain' });
    s3Mock.on(PutObjectCommand).resolves({});
    const r = await runSync(new S3Client({ region: 'us-east-1' }), new S3Client({ region: 'us-east-1' }), source, dest, {
      sameAccount: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.copied).toBe(1);
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(1);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBeGreaterThanOrEqual(1);
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
  });

  it('records a per-object failure and still completes the run', async () => {
    s3Mock.on(ListObjectsV2Command, { Bucket: 'src', Prefix: 'a/' }).resolves({
      Contents: [{ Key: 'a/ok.txt', Size: 1 }, { Key: 'a/bad.txt', Size: 1 }],
    });
    s3Mock.on(ListObjectsV2Command, { Bucket: 'dst', Prefix: 'b/' }).resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand, { Key: 'b/ok.txt' }).resolves({});
    s3Mock.on(CopyObjectCommand, { Key: 'b/bad.txt' }).rejects(new Error('AccessDenied'));
    const r = await runSync(new S3Client({}), new S3Client({}), source, dest, { sameAccount: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.copied).toBe(1);
      expect(r.data.failed).toHaveLength(1);
      expect(r.data.failed[0].key).toBe('a/bad.txt');
    }
  });

  it('an already-aborted signal copies nothing and reports canceled', async () => {
    listings();
    s3Mock.on(CopyObjectCommand).resolves({});
    const controller = new AbortController();
    controller.abort();
    const r = await runSync(new S3Client({}), new S3Client({}), source, dest, {
      sameAccount: true,
      signal: controller.signal,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.canceled).toBe(true);
      expect(r.data.copied).toBe(0);
    }
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
  });

  it('copies every object when there are more than the concurrency limit (pool refills)', async () => {
    const contents = Array.from({ length: 15 }, (_, i) => ({ Key: `a/f${i}.txt`, Size: 1 }));
    s3Mock.on(ListObjectsV2Command, { Bucket: 'src', Prefix: 'a/' }).resolves({ Contents: contents });
    s3Mock.on(ListObjectsV2Command, { Bucket: 'dst', Prefix: 'b/' }).resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});
    const r = await runSync(new S3Client({}), new S3Client({}), source, dest, { sameAccount: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.copied).toBe(15);
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(15);
  });
});
