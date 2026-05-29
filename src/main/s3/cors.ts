import { S3Client, GetBucketCorsCommand } from '@aws-sdk/client-s3';
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
