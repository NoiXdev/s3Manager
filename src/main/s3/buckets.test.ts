import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, CreateBucketCommand, PutBucketVersioningCommand } from '@aws-sdk/client-s3';
import { createBucket } from './buckets';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('createBucket', () => {
  it('creates with a LocationConstraint when set, no versioning by default', async () => {
    s3Mock.on(CreateBucketCommand).resolves({});
    const r = await createBucket(new S3Client({}), { bucket: 'b', objectLock: false, versioning: false, locationConstraint: 'eu-central-1' });
    expect(r).toEqual({ ok: true, data: true });
    const input = s3Mock.commandCalls(CreateBucketCommand)[0].args[0].input;
    expect(input.Bucket).toBe('b');
    expect(input.CreateBucketConfiguration).toEqual({ LocationConstraint: 'eu-central-1' });
    expect(input.ObjectLockEnabledForBucket).toBeUndefined();
    expect(s3Mock.commandCalls(PutBucketVersioningCommand)).toHaveLength(0);
  });

  it('omits CreateBucketConfiguration when locationConstraint is undefined', async () => {
    s3Mock.on(CreateBucketCommand).resolves({});
    await createBucket(new S3Client({}), { bucket: 'b', objectLock: false, versioning: false, locationConstraint: undefined });
    const input = s3Mock.commandCalls(CreateBucketCommand)[0].args[0].input;
    expect(input.CreateBucketConfiguration).toBeUndefined();
  });

  it('enables object lock and versioning when requested', async () => {
    s3Mock.on(CreateBucketCommand).resolves({});
    s3Mock.on(PutBucketVersioningCommand).resolves({});
    await createBucket(new S3Client({}), { bucket: 'b', objectLock: true, versioning: true, locationConstraint: undefined });
    const create = s3Mock.commandCalls(CreateBucketCommand)[0].args[0].input;
    expect(create.ObjectLockEnabledForBucket).toBe(true);
    const ver = s3Mock.commandCalls(PutBucketVersioningCommand)[0].args[0].input;
    expect(ver.Bucket).toBe('b');
    expect(ver.VersioningConfiguration).toEqual({ Status: 'Enabled' });
  });

  it('returns an error result when the create fails', async () => {
    s3Mock.on(CreateBucketCommand).rejects(new Error('BucketAlreadyExists'));
    const r = await createBucket(new S3Client({}), { bucket: 'b', objectLock: false, versioning: false, locationConstraint: undefined });
    expect(r.ok).toBe(false);
  });
});
