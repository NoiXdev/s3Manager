import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetBucketCorsCommand, PutBucketCorsCommand, DeleteBucketCorsCommand } from '@aws-sdk/client-s3';
import { getBucketCors, putBucketCors, deleteBucketCors, type CorsRule } from './cors';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('getBucketCors', () => {
  it('maps SDK CORS rules to CorsRule[]', async () => {
    s3Mock.on(GetBucketCorsCommand).resolves({
      CORSRules: [
        { ID: 'r1', AllowedMethods: ['GET', 'PUT'], AllowedOrigins: ['*'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 },
      ],
    });
    const r = await getBucketCors(new S3Client({}), 'b');
    expect(r).toEqual({
      ok: true,
      data: [
        { id: 'r1', allowedMethods: ['GET', 'PUT'], allowedOrigins: ['*'], allowedHeaders: ['*'], exposeHeaders: ['ETag'], maxAgeSeconds: 3600 },
      ],
    });
  });

  it('returns an empty rule set when the bucket has no CORS config', async () => {
    s3Mock.on(GetBucketCorsCommand).rejects(Object.assign(new Error('none'), { name: 'NoSuchCORSConfiguration' }));
    const r = await getBucketCors(new S3Client({}), 'b');
    expect(r).toEqual({ ok: true, data: [] });
  });

  it('maps other errors to err', async () => {
    s3Mock.on(GetBucketCorsCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    const r = await getBucketCors(new S3Client({}), 'b');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AccessDenied');
  });
});

describe('putBucketCors', () => {
  it('maps CorsRule[] back to SDK rules, omitting empty/null optional fields', async () => {
    s3Mock.on(PutBucketCorsCommand).resolves({});
    const rules: CorsRule[] = [
      { id: 'r1', allowedMethods: ['GET'], allowedOrigins: ['*'], allowedHeaders: ['*'], exposeHeaders: ['ETag'], maxAgeSeconds: 3600 },
      { id: null, allowedMethods: ['PUT'], allowedOrigins: ['https://x'], allowedHeaders: [], exposeHeaders: [], maxAgeSeconds: null },
    ];
    const r = await putBucketCors(new S3Client({}), 'b', rules);
    expect(r).toEqual({ ok: true, data: true });

    const sent = s3Mock.commandCalls(PutBucketCorsCommand)[0].args[0].input.CORSConfiguration!.CORSRules!;
    expect(sent[0]).toEqual({ ID: 'r1', AllowedMethods: ['GET'], AllowedOrigins: ['*'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 });
    expect(sent[1]).toEqual({ AllowedMethods: ['PUT'], AllowedOrigins: ['https://x'] });
  });
});

describe('deleteBucketCors', () => {
  it('sends the delete command and returns ok', async () => {
    s3Mock.on(DeleteBucketCorsCommand).resolves({});
    const r = await deleteBucketCors(new S3Client({}), 'b');
    expect(r).toEqual({ ok: true, data: true });
    expect(s3Mock.commandCalls(DeleteBucketCorsCommand).length).toBe(1);
  });
});
