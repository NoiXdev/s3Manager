import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectLockConfigurationCommand, PutObjectLockConfigurationCommand } from '@aws-sdk/client-s3';
import { getObjectLockConfig, putObjectLockConfig, type DefaultRetention } from './objectLock';

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

describe('putObjectLockConfig', () => {
  it('sends Days when days is set (no Years)', async () => {
    s3Mock.on(PutObjectLockConfigurationCommand).resolves({});
    const retention: DefaultRetention = { mode: 'GOVERNANCE', days: 30, years: null };
    const r = await putObjectLockConfig(new S3Client({}), 'b', retention);
    expect(r).toEqual({ ok: true, data: true });
    const cfg = s3Mock.commandCalls(PutObjectLockConfigurationCommand)[0].args[0].input.ObjectLockConfiguration!;
    expect(cfg).toEqual({ ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'GOVERNANCE', Days: 30 } } });
  });

  it('sends Years when years is set (no Days)', async () => {
    s3Mock.on(PutObjectLockConfigurationCommand).resolves({});
    const retention: DefaultRetention = { mode: 'COMPLIANCE', days: null, years: 2 };
    await putObjectLockConfig(new S3Client({}), 'b', retention);
    const cfg = s3Mock.commandCalls(PutObjectLockConfigurationCommand)[0].args[0].input.ObjectLockConfiguration!;
    expect(cfg).toEqual({ ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: 2 } } });
  });

  it('clears the default retention when retention is null (no Rule)', async () => {
    s3Mock.on(PutObjectLockConfigurationCommand).resolves({});
    const r = await putObjectLockConfig(new S3Client({}), 'b', null);
    expect(r).toEqual({ ok: true, data: true });
    const cfg = s3Mock.commandCalls(PutObjectLockConfigurationCommand)[0].args[0].input.ObjectLockConfiguration!;
    expect(cfg).toEqual({ ObjectLockEnabled: 'Enabled' });
  });
});
