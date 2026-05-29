import { S3Client, GetObjectLockConfigurationCommand, PutObjectLockConfigurationCommand, type ObjectLockConfiguration } from '@aws-sdk/client-s3';
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

export async function putObjectLockConfig(
  client: S3Client,
  bucket: string,
  retention: DefaultRetention | null,
): Promise<Result<true>> {
  try {
    const configuration: ObjectLockConfiguration = { ObjectLockEnabled: 'Enabled' };
    if (retention) {
      const dr: { Mode: 'GOVERNANCE' | 'COMPLIANCE'; Days?: number; Years?: number } = { Mode: retention.mode };
      if (retention.days !== null) dr.Days = retention.days;
      else if (retention.years !== null) dr.Years = retention.years;
      configuration.Rule = { DefaultRetention: dr };
    }
    await client.send(new PutObjectLockConfigurationCommand({ Bucket: bucket, ObjectLockConfiguration: configuration }));
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
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
