import { S3Client, GetBucketVersioningCommand, PutBucketVersioningCommand } from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';

export type VersioningStatus = 'Unversioned' | 'Enabled' | 'Suspended';

export async function getBucketVersioning(
  client: S3Client,
  bucket: string,
): Promise<Result<{ status: VersioningStatus }>> {
  try {
    const out = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    const status: VersioningStatus =
      out.Status === 'Enabled' ? 'Enabled' : out.Status === 'Suspended' ? 'Suspended' : 'Unversioned';
    return ok({ status });
  } catch (e) {
    return toErr(e);
  }
}

export async function putBucketVersioning(
  client: S3Client,
  bucket: string,
  enabled: boolean,
): Promise<Result<true>> {
  try {
    await client.send(
      new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: enabled ? 'Enabled' : 'Suspended' },
      }),
    );
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}
