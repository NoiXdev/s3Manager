import { S3Client, CreateBucketCommand, PutBucketVersioningCommand, type BucketLocationConstraint } from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';

export async function createBucket(
  client: S3Client,
  args: { bucket: string; objectLock: boolean; versioning: boolean; locationConstraint: string | undefined },
): Promise<Result<true>> {
  try {
    await client.send(
      new CreateBucketCommand({
        Bucket: args.bucket,
        CreateBucketConfiguration: args.locationConstraint
          ? { LocationConstraint: args.locationConstraint as BucketLocationConstraint }
          : undefined,
        ObjectLockEnabledForBucket: args.objectLock || undefined,
      }),
    );
    if (args.versioning) {
      await client.send(
        new PutBucketVersioningCommand({ Bucket: args.bucket, VersioningConfiguration: { Status: 'Enabled' } }),
      );
    }
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}
