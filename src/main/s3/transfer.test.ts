import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createFolder } from './transfer';

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
