import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, ListObjectVersionsCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { listObjectVersions, restoreObjectVersion, deleteObjectVersion, removeDeleteMarker } from './objectVersions';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('listObjectVersions', () => {
  it('merges versions and delete markers, filters by exact key, sorts latest first', async () => {
    s3Mock.on(ListObjectVersionsCommand).resolves({
      Versions: [
        { Key: 'a.txt', VersionId: 'v1', IsLatest: false, LastModified: new Date('2024-01-01T00:00:00Z'), Size: 10, ETag: '"e1"' },
        { Key: 'a.txt', VersionId: 'v2', IsLatest: true, LastModified: new Date('2024-03-01T00:00:00Z'), Size: 20, ETag: '"e2"' },
        { Key: 'a.txt.bak', VersionId: 'vX', IsLatest: true, LastModified: new Date('2024-04-01T00:00:00Z'), Size: 5, ETag: '"ex"' },
      ],
      DeleteMarkers: [
        { Key: 'a.txt', VersionId: 'dm1', IsLatest: false, LastModified: new Date('2024-02-01T00:00:00Z') },
      ],
      IsTruncated: false,
    });
    const r = await listObjectVersions(new S3Client({}), { bucket: 'b', key: 'a.txt' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map((v) => v.versionId)).toEqual(['v2', 'dm1', 'v1']);
    expect(r.data[0]).toEqual({ versionId: 'v2', isLatest: true, isDeleteMarker: false, lastModified: '2024-03-01T00:00:00.000Z', size: 20, etag: '"e2"' });
    expect(r.data[1]).toEqual({ versionId: 'dm1', isLatest: false, isDeleteMarker: true, lastModified: '2024-02-01T00:00:00.000Z', size: null, etag: null });
  });

  it('paginates while IsTruncated', async () => {
    s3Mock
      .on(ListObjectVersionsCommand)
      .resolvesOnce({ Versions: [{ Key: 'a.txt', VersionId: 'v1', IsLatest: false, LastModified: new Date('2024-01-01T00:00:00Z'), Size: 1, ETag: '"1"' }], IsTruncated: true, NextKeyMarker: 'a.txt', NextVersionIdMarker: 'v1' })
      .resolves({ Versions: [{ Key: 'a.txt', VersionId: 'v2', IsLatest: true, LastModified: new Date('2024-02-01T00:00:00Z'), Size: 2, ETag: '"2"' }], IsTruncated: false });
    const r = await listObjectVersions(new S3Client({}), { bucket: 'b', key: 'a.txt' });
    expect(r.ok && r.data.map((v) => v.versionId)).toEqual(['v2', 'v1']);
  });

  it('maps errors to err', async () => {
    s3Mock.on(ListObjectVersionsCommand).rejects(Object.assign(new Error('no'), { name: 'NotImplemented' }));
    const r = await listObjectVersions(new S3Client({}), { bucket: 'b', key: 'a.txt' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NotImplemented');
  });
});

describe('restoreObjectVersion', () => {
  it('copies the chosen version onto the key', async () => {
    s3Mock.on(CopyObjectCommand).resolves({});
    const r = await restoreObjectVersion(new S3Client({}), { bucket: 'b', key: 'dir/a b.txt', versionId: 'v1' });
    expect(r).toEqual({ ok: true, data: true });
    const input = s3Mock.commandCalls(CopyObjectCommand)[0].args[0].input;
    expect(input.Bucket).toBe('b');
    expect(input.Key).toBe('dir/a b.txt');
    expect(input.CopySource).toBe('b/dir/a%20b.txt?versionId=v1');
  });
});

describe('deleteObjectVersion / removeDeleteMarker', () => {
  it('deleteObjectVersion sends DeleteObject with the version id', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    const r = await deleteObjectVersion(new S3Client({}), { bucket: 'b', key: 'a.txt', versionId: 'v1' });
    expect(r).toEqual({ ok: true, data: true });
    const input = s3Mock.commandCalls(DeleteObjectCommand)[0].args[0].input;
    expect(input).toMatchObject({ Bucket: 'b', Key: 'a.txt', VersionId: 'v1' });
  });

  it('removeDeleteMarker sends DeleteObject with the marker version id', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    const r = await removeDeleteMarker(new S3Client({}), { bucket: 'b', key: 'a.txt', versionId: 'dm1' });
    expect(r).toEqual({ ok: true, data: true });
    expect(s3Mock.commandCalls(DeleteObjectCommand)[0].args[0].input).toMatchObject({ Bucket: 'b', Key: 'a.txt', VersionId: 'dm1' });
  });
});
