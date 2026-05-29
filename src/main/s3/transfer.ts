import { S3Client, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { ok, err, type Result } from '../shared/result';
import { toErr } from './objects';

export async function createFolder(
  client: S3Client,
  args: { bucket: string; prefix: string; name: string },
): Promise<Result<{ key: string }>> {
  const name = args.name.trim();
  if (name === '' || name.includes('/')) {
    return err('InvalidName', 'Folder name must be non-empty and contain no "/"');
  }
  try {
    const key = `${args.prefix}${name}/`;
    await client.send(new PutObjectCommand({ Bucket: args.bucket, Key: key, Body: '' }));
    return ok({ key });
  } catch (e) {
    return toErr(e);
  }
}

/** Build a CopySource that encodes special chars but preserves the "/" path separators. */
export function encodeCopyKey(key: string): string {
  return encodeURIComponent(key).replace(/%2F/g, '/');
}

export async function moveObject(
  client: S3Client,
  args: { bucket: string; sourceKey: string; destKey: string },
): Promise<Result<{ key: string }>> {
  if (args.destKey === '' || args.destKey === args.sourceKey) {
    return err('InvalidDestination', 'Destination must be non-empty and different from the source');
  }
  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: args.bucket,
        CopySource: `${args.bucket}/${encodeCopyKey(args.sourceKey)}`,
        Key: args.destKey,
      }),
    );
    await client.send(new DeleteObjectCommand({ Bucket: args.bucket, Key: args.sourceKey }));
    return ok({ key: args.destKey });
  } catch (e) {
    return toErr(e);
  }
}
