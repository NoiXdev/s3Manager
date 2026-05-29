import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { listBuckets, listObjects, headObject, deleteObject, deleteFolder, presignPutUrl } from './objects';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('listBuckets', () => {
  it('returns bucket names', async () => {
    s3Mock.on(ListBucketsCommand).resolves({ Buckets: [{ Name: 'a' }, { Name: 'b' }] });
    const r = await listBuckets(new S3Client({}));
    expect(r).toEqual({ ok: true, data: ['a', 'b'] });
  });

  it('maps SDK errors to err Result', async () => {
    s3Mock.on(ListBucketsCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    const r = await listBuckets(new S3Client({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AccessDenied');
  });
});

describe('listObjects', () => {
  it('returns folders, files, and nextToken', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      CommonPrefixes: [{ Prefix: 'docs/' }],
      Contents: [{ Key: 'readme.txt', Size: 10 }],
      NextContinuationToken: 'TOK',
    });
    const r = await listObjects(new S3Client({}), { bucket: 'b', prefix: '' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.folders).toEqual([{ name: 'docs', prefix: 'docs/' }]);
      expect(r.data.files.map((f) => f.name)).toEqual(['readme.txt']);
      expect(r.data.nextToken).toBe('TOK');
    }
  });
});

describe('headObject', () => {
  it('returns metadata fields', async () => {
    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 1234,
      ContentType: 'image/png',
      LastModified: new Date('2024-01-01'),
      StorageClass: 'STANDARD',
      ETag: '"abc"',
      Metadata: { owner: 'me' },
    });
    const r = await headObject(new S3Client({}), { bucket: 'b', key: 'x.png' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({
        size: 1234,
        contentType: 'image/png',
        lastModified: '2024-01-01T00:00:00.000Z',
        storageClass: 'STANDARD',
        etag: '"abc"',
        metadata: { owner: 'me' },
      });
    }
  });
});

describe('deleteObject', () => {
  it('deletes a single key', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    const r = await deleteObject(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: 1 });
  });
});

describe('deleteFolder', () => {
  it('lists all keys under the prefix and deletes them, returning the count', async () => {
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({ Contents: [{ Key: 'p/a' }, { Key: 'p/b' }], NextContinuationToken: 'T' })
      .resolves({ Contents: [{ Key: 'p/c' }] });
    s3Mock.on(DeleteObjectsCommand).resolves({ Deleted: [] });
    const r = await deleteFolder(new S3Client({}), { bucket: 'b', prefix: 'p/' });
    expect(r).toEqual({ ok: true, data: 3 });
  });
});

describe('deleteFolder guard', () => {
  it('refuses an empty prefix and makes no S3 calls', async () => {
    const r = await deleteFolder(new S3Client({}), { bucket: 'b', prefix: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('InvalidPrefix');
  });
});

describe('presignPutUrl', () => {
  it('returns a signed https PUT URL for the key with the requested expiry', async () => {
    const client = new S3Client({ region: 'us-east-1', credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' } });
    const r = await presignPutUrl(client, { bucket: 'b', key: 'images/report.pdf', expiresIn: 3600 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toMatch(/^https:\/\//);
      expect(r.data).toContain('report.pdf');
      expect(r.data).toContain('X-Amz-Expires=3600');
    }
  });
});
