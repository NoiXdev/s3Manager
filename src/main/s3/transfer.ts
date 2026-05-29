import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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
