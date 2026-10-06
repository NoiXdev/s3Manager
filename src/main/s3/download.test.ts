import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadObject } from './objects';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('downloadObject', () => {
  it('streams the object body to a local file', async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: Readable.from([Buffer.from('file bytes')]) as never });
    const dir = mkdtempSync(join(tmpdir(), 's3m-'));
    const dest = join(dir, 'out.bin');

    const r = await downloadObject(new S3Client({}), { bucket: 'b', key: 'k', destPath: dest });
    expect(r).toEqual({ ok: true, data: { path: dest } });
    expect(readFileSync(dest, 'utf8')).toBe('file bytes');
  });

  it('includes VersionId in the GetObject request when provided', async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: Readable.from([Buffer.from('hi')]) as never });
    const dir = mkdtempSync(join(tmpdir(), 's3m-'));
    const dest = join(dir, 'out.bin');

    const r = await downloadObject(new S3Client({}), { bucket: 'b', key: 'a.txt', destPath: dest, versionId: 'v1' });
    expect(r).toEqual({ ok: true, data: { path: dest } });
    expect(s3Mock.commandCalls(GetObjectCommand)[0].args[0].input).toMatchObject({
      Bucket: 'b',
      Key: 'a.txt',
      VersionId: 'v1',
    });
  });

  it('omits VersionId from the GetObject request when not provided', async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: Readable.from([Buffer.from('hi')]) as never });
    const dir = mkdtempSync(join(tmpdir(), 's3m-'));
    const dest = join(dir, 'out2.bin');

    await downloadObject(new S3Client({}), { bucket: 'b', key: 'a.txt', destPath: dest });
    expect(s3Mock.commandCalls(GetObjectCommand)[0].args[0].input.VersionId).toBeUndefined();
  });
});
