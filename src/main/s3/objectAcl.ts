import { S3Client, GetObjectAclCommand, PutObjectAclCommand, type Grant, type Grantee } from '@aws-sdk/client-s3';
import { ok, err, type Result } from '../shared/result';
import { toErr } from './objects';

export type AclPermission = 'FULL_CONTROL' | 'WRITE' | 'WRITE_ACP' | 'READ' | 'READ_ACP';
export type GranteeType = 'CanonicalUser' | 'Group' | 'AmazonCustomerByEmail';

export interface AclGrant {
  granteeType: GranteeType;
  permission: AclPermission;
  id?: string;
  displayName?: string;
  uri?: string;
  email?: string;
}

export interface ObjectAcl {
  owner: { id: string; displayName: string | null };
  grants: AclGrant[];
}

const ACL_UNSUPPORTED = new Set(['AccessControlListNotSupported', 'NotImplemented']);

function fromAwsGrant(g: Grant): AclGrant {
  const grantee = g.Grantee;
  const permission = g.Permission as AclPermission;
  if (grantee?.Type === 'Group') return { granteeType: 'Group', uri: grantee.URI, permission };
  if (grantee?.Type === 'AmazonCustomerByEmail') return { granteeType: 'AmazonCustomerByEmail', email: grantee.EmailAddress, permission };
  return { granteeType: 'CanonicalUser', id: grantee?.ID, displayName: grantee?.DisplayName, permission };
}

function toAwsGrant(grant: AclGrant): Grant {
  let grantee: Grantee;
  if (grant.granteeType === 'Group') grantee = { Type: 'Group', URI: grant.uri };
  else if (grant.granteeType === 'AmazonCustomerByEmail') grantee = { Type: 'AmazonCustomerByEmail', EmailAddress: grant.email };
  else grantee = { Type: 'CanonicalUser', ID: grant.id, DisplayName: grant.displayName };
  return { Grantee: grantee, Permission: grant.permission };
}

export async function getObjectAcl(
  client: S3Client,
  args: { bucket: string; key: string },
): Promise<Result<ObjectAcl>> {
  try {
    const out = await client.send(new GetObjectAclCommand({ Bucket: args.bucket, Key: args.key }));
    return ok({
      owner: { id: out.Owner?.ID ?? '', displayName: out.Owner?.DisplayName ?? null },
      grants: (out.Grants ?? []).map(fromAwsGrant),
    });
  } catch (e) {
    if (ACL_UNSUPPORTED.has((e as { name?: string })?.name ?? '')) {
      return err('AclUnsupported', 'This bucket does not support per-object ACLs');
    }
    return toErr(e);
  }
}

export async function putObjectAcl(
  client: S3Client,
  args: { bucket: string; key: string; acl: ObjectAcl },
): Promise<Result<true>> {
  try {
    await client.send(
      new PutObjectAclCommand({
        Bucket: args.bucket,
        Key: args.key,
        AccessControlPolicy: {
          Owner: { ID: args.acl.owner.id, DisplayName: args.acl.owner.displayName ?? undefined },
          Grants: args.acl.grants.map(toAwsGrant),
        },
      }),
    );
    return ok(true);
  } catch (e) {
    if (ACL_UNSUPPORTED.has((e as { name?: string })?.name ?? '')) {
      return err('AclUnsupported', 'This bucket does not support per-object ACLs');
    }
    return toErr(e);
  }
}
