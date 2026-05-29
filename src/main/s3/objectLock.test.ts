import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectLockConfigurationCommand } from '@aws-sdk/client-s3';
import { getObjectLockConfig } from './objectLock';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('getObjectLockConfig', () => {
  it('maps an enabled config with a default retention', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand).resolves({
      ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'GOVERNANCE', Days: 30 } } },
    });
    const r = await getObjectLockConfig(new S3Client({}), 'b');
    expect(r).toEqual({ ok: true, data: { enabled: true, defaultRetention: { mode: 'GOVERNANCE', days: 30, years: null } } });
  });

  it('maps enabled with no default retention rule', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand).resolves({ ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled' } });
    const r = await getObjectLockConfig(new S3Client({}), 'b');
    expect(r).toEqual({ ok: true, data: { enabled: true, defaultRetention: null } });
  });

  it('treats ObjectLockConfigurationNotFoundError as not-enabled', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand).rejects(Object.assign(new Error('none'), { name: 'ObjectLockConfigurationNotFoundError' }));
    const r = await getObjectLockConfig(new S3Client({}), 'b');
    expect(r).toEqual({ ok: true, data: { enabled: false, defaultRetention: null } });
  });

  it('maps other errors to err', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    const r = await getObjectLockConfig(new S3Client({}), 'b');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AccessDenied');
  });
});
