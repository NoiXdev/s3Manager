import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createFolder, moveObject } from './transfer';

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
