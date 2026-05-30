import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getEditableMetadata, updateObjectMetadata } from './objectMetadata';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('getEditableMetadata', () => {
  it('maps the editable fields', async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentType: 'text/plain', CacheControl: 'max-age=60', ContentDisposition: 'inline', Metadata: { owner: 'me' } });
    const r = await getEditableMetadata(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: { contentType: 'text/plain', cacheControl: 'max-age=60', contentDisposition: 'inline', metadata: { owner: 'me' } } });
  });

  it('maps absent fields to null / empty', async () => {
    s3Mock.on(HeadObjectCommand).resolves({});
    const r = await getEditableMetadata(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: { contentType: null, cacheControl: null, contentDisposition: null, metadata: {} } });
  });
});

describe('updateObjectMetadata', () => {
  it('heads then copies-to-self with REPLACE, applying edits and preserving system headers', async () => {
    s3Mock.on(HeadObjectCommand).resolves({ StorageClass: 'STANDARD_IA', ContentEncoding: 'gzip', ContentLanguage: 'en' });
    s3Mock.on(CopyObjectCommand).resolves({});
    const r = await updateObjectMetadata(new S3Client({}), {
      bucket: 'b',
      key: 'dir/a b.txt',
      contentType: 'application/json',
      cacheControl: 'no-cache',
      contentDisposition: 'attachment',
      metadata: { author: 'x' },
    });
    expect(r).toEqual({ ok: true, data: true });
    const input = s3Mock.commandCalls(CopyObjectCommand)[0].args[0].input;
    expect(input.MetadataDirective).toBe('REPLACE');
    expect(input.CopySource).toBe('b/dir/a%20b.txt');
    expect(input.Key).toBe('dir/a b.txt');
    expect(input.ContentType).toBe('application/json');
    expect(input.CacheControl).toBe('no-cache');
    expect(input.ContentDisposition).toBe('attachment');
    expect(input.Metadata).toEqual({ author: 'x' });
    expect(input.StorageClass).toBe('STANDARD_IA');
    expect(input.ContentEncoding).toBe('gzip');
    expect(input.ContentLanguage).toBe('en');
  });

  it('sends undefined for cleared (empty) header fields', async () => {
    s3Mock.on(HeadObjectCommand).resolves({});
    s3Mock.on(CopyObjectCommand).resolves({});
    await updateObjectMetadata(new S3Client({}), { bucket: 'b', key: 'k', contentType: '', cacheControl: null, contentDisposition: '', metadata: {} });
    const input = s3Mock.commandCalls(CopyObjectCommand)[0].args[0].input;
    expect(input.ContentType).toBeUndefined();
    expect(input.CacheControl).toBeUndefined();
    expect(input.ContentDisposition).toBeUndefined();
  });
});
