import { S3Client, GetObjectAclCommand, PutObjectAclCommand } from '@aws-sdk/client-s3';
import { ok, err, type Result } from '../shared/result';
import { toErr } from './objects';

export type Visibility = 'public' | 'private' | 'unknown';

const ALL_USERS = 'http://acs.amazonaws.com/groups/global/AllUsers';
const ACL_UNSUPPORTED = new Set([
  'AccessControlListNotSupported',
  'NotImplemented',
]);

export async function getObjectVisibility(
  client: S3Client,
  args: { bucket: string; key: string },
): Promise<Result<Visibility>> {
  try {
    const out = await client.send(
      new GetObjectAclCommand({ Bucket: args.bucket, Key: args.key }),
    );
    const isPublic = (out.Grants ?? []).some(
      (g) =>
        g.Grantee?.URI === ALL_USERS &&
        (g.Permission === 'READ' || g.Permission === 'FULL_CONTROL'),
    );
    return ok(isPublic ? 'public' : 'private');
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    if (ACL_UNSUPPORTED.has(name)) return ok('unknown');
    return toErr(e);
  }
}

export async function setObjectVisibility(
  client: S3Client,
  args: { bucket: string; key: string; visibility: 'public' | 'private' },
): Promise<Result<Visibility>> {
  try {
    await client.send(
      new PutObjectAclCommand({
        Bucket: args.bucket,
        Key: args.key,
        ACL: args.visibility === 'public' ? 'public-read' : 'private',
      }),
    );
    return ok(args.visibility);
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    if (ACL_UNSUPPORTED.has(name)) {
      return err('AclUnsupported', 'This bucket does not support per-object ACLs');
    }
    return toErr(e);
  }
}
