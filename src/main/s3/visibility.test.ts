import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectAclCommand } from '@aws-sdk/client-s3';
import { getObjectVisibility } from './visibility';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

const PUBLIC_GROUP = 'http://acs.amazonaws.com/groups/global/AllUsers';

describe('getObjectVisibility', () => {
  it('is public when AllUsers has READ', async () => {
    s3Mock.on(GetObjectAclCommand).resolves({
      Grants: [{ Grantee: { Type: 'Group', URI: PUBLIC_GROUP }, Permission: 'READ' }],
    });
    const r = await getObjectVisibility(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: 'public' });
  });

  it('is private with no public grant', async () => {
    s3Mock.on(GetObjectAclCommand).resolves({ Grants: [] });
    const r = await getObjectVisibility(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: 'private' });
  });

  it('is unknown when ACLs are not supported', async () => {
    s3Mock.on(GetObjectAclCommand).rejects(Object.assign(new Error('x'), { name: 'AccessControlListNotSupported' }));
    const r = await getObjectVisibility(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: 'unknown' });
  });
});
