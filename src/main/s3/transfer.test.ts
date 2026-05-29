import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { createFolder, moveObject, moveFolder } from './transfer';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('createFolder', () => {
  it('puts an empty object at prefix+name+"/"', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const r = await createFolder(new S3Client({}), { bucket: 'b', prefix: 'images/', name: 'new' });
    expect(r).toEqual({ ok: true, data: { key: 'images/new/' } });
    const input = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(input.Bucket).toBe('b');
    expect(input.Key).toBe('images/new/');
  });

  it('rejects an empty name', async () => {
    const r = await createFolder(new S3Client({}), { bucket: 'b', prefix: '', name: '  ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('InvalidName');
  });

  it('rejects a name containing a slash', async () => {
    const r = await createFolder(new S3Client({}), { bucket: 'b', prefix: '', name: 'a/b' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('InvalidName');
  });
});

describe('moveObject', () => {
  it('copies (encoded source) then deletes the original', async () => {
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    const r = await moveObject(new S3Client({}), { bucket: 'b', sourceKey: 'a/old name.txt', destKey: 'a/new.txt' });
    expect(r).toEqual({ ok: true, data: { key: 'a/new.txt' } });
    const copy = s3Mock.commandCalls(CopyObjectCommand)[0].args[0].input;
    expect(copy.CopySource).toBe('b/a/old%20name.txt'); // spaces encoded, slashes preserved
    expect(copy.Key).toBe('a/new.txt');
    expect(s3Mock.commandCalls(DeleteObjectCommand)[0].args[0].input.Key).toBe('a/old name.txt');
  });

  it('rejects when destKey equals sourceKey or is empty', async () => {
    const same = await moveObject(new S3Client({}), { bucket: 'b', sourceKey: 'k', destKey: 'k' });
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.error.code).toBe('InvalidDestination');
    const empty = await moveObject(new S3Client({}), { bucket: 'b', sourceKey: 'k', destKey: '' });
    expect(empty.ok).toBe(false);
  });

  it('does not delete the source when the copy fails', async () => {
    s3Mock.on(CopyObjectCommand).rejects(new Error('AccessDenied'));
    s3Mock.on(DeleteObjectCommand).resolves({});
    const r = await moveObject(new S3Client({}), { bucket: 'b', sourceKey: 'a/x.txt', destKey: 'a/y.txt' });
    expect(r.ok).toBe(false);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });
});

describe('moveFolder', () => {
  it('copies every key rebased onto destPrefix, deletes originals, returns the count', async () => {
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({ Contents: [{ Key: 'old/a' }, { Key: 'old/sub/b' }], NextContinuationToken: 'T' })
      .resolves({ Contents: [{ Key: 'old/c' }] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectsCommand).resolves({ Deleted: [] });
    const r = await moveFolder(new S3Client({}), { bucket: 'b', sourcePrefix: 'old/', destPrefix: 'new/' });
    expect(r).toEqual({ ok: true, data: { count: 3 } });
    const copyKeys = s3Mock.commandCalls(CopyObjectCommand).map((c) => c.args[0].input.Key);
    expect(copyKeys).toEqual(['new/a', 'new/sub/b', 'new/c']);
  });

  it('rejects an empty/root source or destination prefix', async () => {
    const emptySource = await moveFolder(new S3Client({}), { bucket: 'b', sourcePrefix: '', destPrefix: 'new/' });
    expect(emptySource.ok).toBe(false);
    if (!emptySource.ok) expect(emptySource.error.code).toBe('InvalidDestination');
    const emptyDest = await moveFolder(new S3Client({}), { bucket: 'b', sourcePrefix: 'old/', destPrefix: '' });
    expect(emptyDest.ok).toBe(false);
    const rootDest = await moveFolder(new S3Client({}), { bucket: 'b', sourcePrefix: 'old/', destPrefix: '/' });
    expect(rootDest.ok).toBe(false);
  });

  it('rejects moving a folder into itself', async () => {
    const r = await moveFolder(new S3Client({}), { bucket: 'b', sourcePrefix: 'old/', destPrefix: 'old/sub/' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('InvalidDestination');
  });

  it('allows a destination that merely shares a leading substring (old/ -> older/)', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectsCommand).resolves({ Deleted: [] });
    const r = await moveFolder(new S3Client({}), { bucket: 'b', sourcePrefix: 'old/', destPrefix: 'older/' });
    expect(r.ok).toBe(true);
  });
});
