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
});
