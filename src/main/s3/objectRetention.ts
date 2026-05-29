import {
  S3Client,
  GetObjectRetentionCommand,
  PutObjectRetentionCommand,
  GetObjectLegalHoldCommand,
  PutObjectLegalHoldCommand,
} from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';

export interface ObjectRetention {
  mode: 'GOVERNANCE' | 'COMPLIANCE' | null;
  retainUntil: string | null; // ISO string
}
export type LegalHoldStatus = 'ON' | 'OFF';

/** Error names meaning "no retention / legal hold is set on this object". */
const NOT_SET = new Set(['NoSuchObjectLockConfiguration']);

export async function getObjectRetention(
  client: S3Client,
  args: { bucket: string; key: string },
): Promise<Result<ObjectRetention>> {
  try {
    const out = await client.send(new GetObjectRetentionCommand({ Bucket: args.bucket, Key: args.key }));
    const ret = out.Retention;
    return ok({
      mode: (ret?.Mode as 'GOVERNANCE' | 'COMPLIANCE' | undefined) ?? null,
      retainUntil: ret?.RetainUntilDate ? ret.RetainUntilDate.toISOString() : null,
    });
  } catch (e) {
    if (NOT_SET.has((e as { name?: string })?.name ?? '')) return ok({ mode: null, retainUntil: null });
    return toErr(e);
  }
}

export async function getObjectLegalHold(
  client: S3Client,
  args: { bucket: string; key: string },
): Promise<Result<LegalHoldStatus>> {
  try {
    const out = await client.send(new GetObjectLegalHoldCommand({ Bucket: args.bucket, Key: args.key }));
    return ok(out.LegalHold?.Status === 'ON' ? 'ON' : 'OFF');
  } catch (e) {
    if (NOT_SET.has((e as { name?: string })?.name ?? '')) return ok('OFF');
    return toErr(e);
  }
}

export async function putObjectRetention(
  client: S3Client,
  args: { bucket: string; key: string; retainUntil: string },
): Promise<Result<true>> {
  try {
    await client.send(
      new PutObjectRetentionCommand({
        Bucket: args.bucket,
        Key: args.key,
        Retention: { Mode: 'GOVERNANCE', RetainUntilDate: new Date(args.retainUntil) },
      }),
    );
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}

export async function putObjectLegalHold(
  client: S3Client,
  args: { bucket: string; key: string; status: LegalHoldStatus },
): Promise<Result<true>> {
  try {
    await client.send(
      new PutObjectLegalHoldCommand({ Bucket: args.bucket, Key: args.key, LegalHold: { Status: args.status } }),
    );
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}
