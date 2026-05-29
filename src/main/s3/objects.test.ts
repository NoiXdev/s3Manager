import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { listBuckets, listObjects } from './objects';

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
