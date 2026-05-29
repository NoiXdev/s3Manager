import { S3Client, GetBucketCorsCommand, PutBucketCorsCommand, DeleteBucketCorsCommand, type CORSRule } from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';

export interface CorsRule {
  id: string | null;
  allowedMethods: string[];
  allowedOrigins: string[];
  allowedHeaders: string[];
  exposeHeaders: string[];
  maxAgeSeconds: number | null;
}

function toSdkRule(rule: CorsRule): CORSRule {
  const out: CORSRule = {
    AllowedMethods: rule.allowedMethods,
    AllowedOrigins: rule.allowedOrigins,
  };
  if (rule.allowedHeaders.length) out.AllowedHeaders = rule.allowedHeaders;
  if (rule.exposeHeaders.length) out.ExposeHeaders = rule.exposeHeaders;
  if (rule.id) out.ID = rule.id;
  if (rule.maxAgeSeconds !== null) out.MaxAgeSeconds = rule.maxAgeSeconds;
  return out;
}

export async function putBucketCors(client: S3Client, bucket: string, rules: CorsRule[]): Promise<Result<true>> {
  try {
    await client.send(
      new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: rules.map(toSdkRule) } }),
    );
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}

export async function deleteBucketCors(client: S3Client, bucket: string): Promise<Result<true>> {
  try {
    await client.send(new DeleteBucketCorsCommand({ Bucket: bucket }));
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}

export async function getBucketCors(client: S3Client, bucket: string): Promise<Result<CorsRule[]>> {
  try {
    const out = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    const rules: CorsRule[] = (out.CORSRules ?? []).map((r) => ({
      id: r.ID ?? null,
      allowedMethods: r.AllowedMethods ?? [],
      allowedOrigins: r.AllowedOrigins ?? [],
      allowedHeaders: r.AllowedHeaders ?? [],
      exposeHeaders: r.ExposeHeaders ?? [],
      maxAgeSeconds: r.MaxAgeSeconds ?? null,
    }));
    return ok(rules);
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    if (name === 'NoSuchCORSConfiguration') return ok([]);
    return toErr(e);
  }
}
