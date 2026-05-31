import { S3Client, CreateBucketCommand, PutBucketVersioningCommand, type BucketLocationConstraint } from '@aws-sdk/client-s3';
import { ok, err, type Result } from '../shared/result';
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
  } catch (e) {
    return toErr(e);
  }

  if (args.versioning) {
    try {
      await client.send(
        new PutBucketVersioningCommand({ Bucket: args.bucket, VersioningConfiguration: { Status: 'Enabled' } }),
      );
    } catch (e) {
      return err('VersioningFailed', `Bucket "${args.bucket}" was created, but enabling versioning failed: ${(e as Error).message}`);
    }
  }

  return ok(true);
}
