import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uploadObject } from './objects';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('uploadObject', () => {
  it('uploads a local file and resolves ok', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const dir = mkdtempSync(join(tmpdir(), 's3m-'));
    const file = join(dir, 'hello.txt');
    writeFileSync(file, 'hello world');

    const r = await uploadObject(new S3Client({ region: 'us-east-1' }), {
      bucket: 'b',
      key: 'hello.txt',
      filePath: file,
      contentType: 'text/plain',
    });
    expect(r).toEqual({ ok: true, data: { key: 'hello.txt' } });
  });
});
