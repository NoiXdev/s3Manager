import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectAclCommand, PutObjectAclCommand } from '@aws-sdk/client-s3';
import { getObjectAcl, putObjectAcl } from './objectAcl';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

const ALL_USERS = 'http://acs.amazonaws.com/groups/global/AllUsers';

describe('getObjectAcl', () => {
  it('maps owner and canonical/group/email grants', async () => {
    s3Mock.on(GetObjectAclCommand).resolves({
      Owner: { ID: 'owner-1', DisplayName: 'me' },
      Grants: [
        { Grantee: { Type: 'CanonicalUser', ID: 'owner-1', DisplayName: 'me' }, Permission: 'FULL_CONTROL' },
        { Grantee: { Type: 'Group', URI: ALL_USERS }, Permission: 'READ' },
        { Grantee: { Type: 'AmazonCustomerByEmail', EmailAddress: 'x@y.com' }, Permission: 'READ' },
      ],
    });
    const r = await getObjectAcl(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.owner).toEqual({ id: 'owner-1', displayName: 'me' });
      expect(r.data.grants).toEqual([
        { granteeType: 'CanonicalUser', id: 'owner-1', displayName: 'me', permission: 'FULL_CONTROL' },
        { granteeType: 'Group', uri: ALL_USERS, permission: 'READ' },
        { granteeType: 'AmazonCustomerByEmail', email: 'x@y.com', permission: 'READ' },
      ]);
    }
  });

  it('maps an ACL-unsupported error to AclUnsupported', async () => {
    s3Mock.on(GetObjectAclCommand).rejects(Object.assign(new Error('no'), { name: 'AccessControlListNotSupported' }));
    const r = await getObjectAcl(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AclUnsupported');
  });
});

describe('putObjectAcl', () => {
  it('sends the owner and grants mapped back to AWS shapes', async () => {
    s3Mock.on(PutObjectAclCommand).resolves({});
    const r = await putObjectAcl(new S3Client({}), {
      bucket: 'b',
      key: 'k',
      acl: {
        owner: { id: 'owner-1', displayName: 'me' },
        grants: [
          { granteeType: 'CanonicalUser', id: 'owner-1', displayName: 'me', permission: 'FULL_CONTROL' },
          { granteeType: 'Group', uri: ALL_USERS, permission: 'READ' },
          { granteeType: 'AmazonCustomerByEmail', email: 'x@y.com', permission: 'READ' },
        ],
      },
    });
    expect(r).toEqual({ ok: true, data: true });
    const input = s3Mock.commandCalls(PutObjectAclCommand)[0].args[0].input;
    expect(input.AccessControlPolicy?.Owner?.ID).toBe('owner-1');
    const grants = input.AccessControlPolicy?.Grants ?? [];
    expect(grants[1].Grantee).toEqual({ Type: 'Group', URI: ALL_USERS });
    expect(grants[2].Grantee).toEqual({ Type: 'AmazonCustomerByEmail', EmailAddress: 'x@y.com' });
  });
});
