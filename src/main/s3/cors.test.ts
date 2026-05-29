import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetBucketCorsCommand } from '@aws-sdk/client-s3';
import { getBucketCors } from './cors';

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
