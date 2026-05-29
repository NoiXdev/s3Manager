import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { walkDir, contentTypeFor, planLocalSync, runLocalSync } from './localSync';

const s3Mock = mockClient(S3Client);

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 's3m-walk-')); });
beforeEach(() => s3Mock.reset());
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('walkDir', () => {
  it('returns regular files with normalized relKeys and sizes', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello'); // 5 bytes
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'b.txt'), 'hi'); // 2 bytes
    const out = (await walkDir(dir)).sort((x, y) => x.relKey.localeCompare(y.relKey));
    expect(out).toEqual([
      { relKey: 'a.txt', size: 5 },
      { relKey: 'sub/b.txt', size: 2 },
    ]);
  });

  it('returns an empty array for an empty directory', async () => {
    expect(await walkDir(dir)).toEqual([]);
  });
});

describe('contentTypeFor', () => {
  it('maps known extensions and returns undefined otherwise', () => {
    expect(contentTypeFor('logo.png')).toBe('image/png');
    expect(contentTypeFor('a/b/style.css')).toBe('text/css');
    expect(contentTypeFor('data.unknownext')).toBeUndefined();
    expect(contentTypeFor('noext')).toBeUndefined();
  });
});

describe('planLocalSync (upload)', () => {
  it('counts local files missing on the bucket', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello'); // 5
    writeFileSync(join(dir, 'b.txt'), 'yo'); // 2
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    const r = await planLocalSync(new S3Client({}), { direction: 'upload', localPath: dir, remote: { accountId: 'x', bucket: 'b', prefix: '' } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.toCopy).toBe(2);
      expect(r.data.bytesToCopy).toBe(7);
    }
  });
});

describe('runLocalSync (upload)', () => {
  it('uploads each local file to the bucket', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello');
    writeFileSync(join(dir, 'b.txt'), 'yo');
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    s3Mock.on(PutObjectCommand).resolves({});
    const r = await runLocalSync(new S3Client({ region: 'us-east-1' }), { direction: 'upload', localPath: dir, remote: { accountId: 'x', bucket: 'b', prefix: 'up/' } }, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.copied).toBe(2);
    const keys = s3Mock.commandCalls(PutObjectCommand).map((c) => c.args[0].input.Key).sort();
    expect(keys).toEqual(['up/a.txt', 'up/b.txt']);
  });

  it('an already-aborted signal copies nothing and reports canceled', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello');
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    s3Mock.on(PutObjectCommand).resolves({});
    const controller = new AbortController();
    controller.abort();
    const r = await runLocalSync(new S3Client({ region: 'us-east-1' }), { direction: 'upload', localPath: dir, remote: { accountId: 'x', bucket: 'b', prefix: '' } }, { signal: controller.signal });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.data.canceled).toBe(true); expect(r.data.copied).toBe(0); }
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('records a per-file upload failure and still completes', async () => {
    writeFileSync(join(dir, 'ok.txt'), 'hi');
    writeFileSync(join(dir, 'bad.txt'), 'no');
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    s3Mock.on(PutObjectCommand, { Key: 'ok.txt' }).resolves({});
    s3Mock.on(PutObjectCommand, { Key: 'bad.txt' }).rejects(new Error('AccessDenied'));
    const r = await runLocalSync(new S3Client({ region: 'us-east-1' }), { direction: 'upload', localPath: dir, remote: { accountId: 'x', bucket: 'b', prefix: '' } }, {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.copied).toBe(1);
      expect(r.data.failed.map((f) => f.key)).toEqual(['bad.txt']);
    }
  });
});

describe('runLocalSync (download)', () => {
  it('writes each bucket object to disk, creating parent dirs', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'x.txt', Size: 5 }, { Key: 'nested/y.txt', Size: 3 }] });
    s3Mock.on(GetObjectCommand, { Key: 'x.txt' }).resolves({ Body: Readable.from(Buffer.from('hello')) as never });
    s3Mock.on(GetObjectCommand, { Key: 'nested/y.txt' }).resolves({ Body: Readable.from(Buffer.from('yo!')) as never });
    const r = await runLocalSync(new S3Client({}), { direction: 'download', localPath: dir, remote: { accountId: 'x', bucket: 'b', prefix: '' } }, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.copied).toBe(2);
    expect(readFileSync(join(dir, 'x.txt'), 'utf8')).toBe('hello');
    expect(readFileSync(join(dir, 'nested', 'y.txt'), 'utf8')).toBe('yo!');
  });

  it('records a per-object failure and still completes', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'ok.txt', Size: 2 }, { Key: 'bad.txt', Size: 2 }] });
    s3Mock.on(GetObjectCommand, { Key: 'ok.txt' }).resolves({ Body: Readable.from(Buffer.from('hi')) as never });
    s3Mock.on(GetObjectCommand, { Key: 'bad.txt' }).rejects(new Error('AccessDenied'));
    const r = await runLocalSync(new S3Client({}), { direction: 'download', localPath: dir, remote: { accountId: 'x', bucket: 'b', prefix: '' } }, {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.copied).toBe(1);
      expect(r.data.failed).toHaveLength(1);
      expect(r.data.failed[0].key).toBe('bad.txt');
    }
    expect(existsSync(join(dir, 'ok.txt'))).toBe(true);
  });
});
