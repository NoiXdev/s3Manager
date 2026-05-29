import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { listAll, planSync } from './sync';

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
