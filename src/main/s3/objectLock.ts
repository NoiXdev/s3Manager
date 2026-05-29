import { S3Client, GetObjectLockConfigurationCommand } from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';

export interface DefaultRetention {
  mode: 'GOVERNANCE' | 'COMPLIANCE';
  days: number | null;
  years: number | null;
}

export interface ObjectLockStatus {
  enabled: boolean;
  defaultRetention: DefaultRetention | null;
}

export async function getObjectLockConfig(client: S3Client, bucket: string): Promise<Result<ObjectLockStatus>> {
  try {
    const out = await client.send(new GetObjectLockConfigurationCommand({ Bucket: bucket }));
    const cfg = out.ObjectLockConfiguration;
    const enabled = cfg?.ObjectLockEnabled === 'Enabled';
    const dr = cfg?.Rule?.DefaultRetention;
    const defaultRetention: DefaultRetention | null = dr
      ? { mode: dr.Mode as 'GOVERNANCE' | 'COMPLIANCE', days: dr.Days ?? null, years: dr.Years ?? null }
      : null;
    return ok({ enabled, defaultRetention });
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    if (name === 'ObjectLockConfigurationNotFoundError') return ok({ enabled: false, defaultRetention: null });
    return toErr(e);
  }
}
