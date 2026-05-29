import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectAclCommand, PutObjectAclCommand } from '@aws-sdk/client-s3';
import { getObjectVisibility, setObjectVisibility } from './visibility';

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

describe('setObjectVisibility', () => {
  it('sets the public-read canned ACL and returns public', async () => {
    s3Mock.on(PutObjectAclCommand).resolves({});
    const r = await setObjectVisibility(new S3Client({}), { bucket: 'b', key: 'k', visibility: 'public' });
    expect(r).toEqual({ ok: true, data: 'public' });
    expect(s3Mock.commandCalls(PutObjectAclCommand)[0].args[0].input.ACL).toBe('public-read');
  });

  it('sets the private canned ACL and returns private', async () => {
    s3Mock.on(PutObjectAclCommand).resolves({});
    const r = await setObjectVisibility(new S3Client({}), { bucket: 'b', key: 'k', visibility: 'private' });
    expect(r).toEqual({ ok: true, data: 'private' });
    expect(s3Mock.commandCalls(PutObjectAclCommand)[0].args[0].input.ACL).toBe('private');
  });

  it('maps an ACL-unsupported error to AclUnsupported', async () => {
    s3Mock.on(PutObjectAclCommand).rejects(Object.assign(new Error('no'), { name: 'AccessControlListNotSupported' }));
    const r = await setObjectVisibility(new S3Client({}), { bucket: 'b', key: 'k', visibility: 'public' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AclUnsupported');
  });
});
