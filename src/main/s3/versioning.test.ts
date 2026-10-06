import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetBucketVersioningCommand, PutBucketVersioningCommand } from '@aws-sdk/client-s3';
import { getBucketVersioning, putBucketVersioning } from './versioning';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('getBucketVersioning', () => {
  it('maps Status Enabled', async () => {
    s3Mock.on(GetBucketVersioningCommand).resolves({ Status: 'Enabled' });
    expect(await getBucketVersioning(new S3Client({}), 'b')).toEqual({ ok: true, data: { status: 'Enabled' } });
  });

  it('maps Status Suspended', async () => {
    s3Mock.on(GetBucketVersioningCommand).resolves({ Status: 'Suspended' });
    expect(await getBucketVersioning(new S3Client({}), 'b')).toEqual({ ok: true, data: { status: 'Suspended' } });
  });

  it('maps a missing Status to Unversioned', async () => {
    s3Mock.on(GetBucketVersioningCommand).resolves({});
    expect(await getBucketVersioning(new S3Client({}), 'b')).toEqual({ ok: true, data: { status: 'Unversioned' } });
  });

  it('maps errors to err', async () => {
    s3Mock.on(GetBucketVersioningCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    const r = await getBucketVersioning(new S3Client({}), 'b');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AccessDenied');
  });
});

describe('putBucketVersioning', () => {
  it('sends Status Enabled when enabled', async () => {
    s3Mock.on(PutBucketVersioningCommand).resolves({});
    expect(await putBucketVersioning(new S3Client({}), 'b', true)).toEqual({ ok: true, data: true });
    expect(s3Mock.commandCalls(PutBucketVersioningCommand)[0].args[0].input.VersioningConfiguration).toEqual({ Status: 'Enabled' });
  });

  it('sends Status Suspended when not enabled', async () => {
    s3Mock.on(PutBucketVersioningCommand).resolves({});
    await putBucketVersioning(new S3Client({}), 'b', false);
    expect(s3Mock.commandCalls(PutBucketVersioningCommand)[0].args[0].input.VersioningConfiguration).toEqual({ Status: 'Suspended' });
  });
});
