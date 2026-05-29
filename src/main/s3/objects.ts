import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { ok, err, type Result } from '../shared/result';
import { transformListing, type Listing } from './listTransform';

export function toErr(e: unknown): Result<never> {
  const code = (e as { name?: string })?.name ?? 'UnknownError';
  const message = (e as { message?: string })?.message ?? 'Unexpected error';
  return err(code, message);
}

export async function listBuckets(client: S3Client): Promise<Result<string[]>> {
  try {
    const out = await client.send(new ListBucketsCommand({}));
    return ok((out.Buckets ?? []).map((b) => b.Name!).filter(Boolean));
  } catch (e) {
    return toErr(e);
  }
}

export interface ListObjectsArgs {
  bucket: string;
  prefix: string;
  continuationToken?: string;
}

export interface ListObjectsResult extends Listing {
  nextToken: string | null;
}

export async function listObjects(
  client: S3Client,
  args: ListObjectsArgs,
): Promise<Result<ListObjectsResult>> {
  try {
    const out = await client.send(
      new ListObjectsV2Command({
        Bucket: args.bucket,
        Prefix: args.prefix || undefined,
        Delimiter: '/',
        ContinuationToken: args.continuationToken,
      }),
    );
    const listing = transformListing(out, args.prefix);
    return ok({ ...listing, nextToken: out.NextContinuationToken ?? null });
  } catch (e) {
    return toErr(e);
  }
}

export interface ObjectMetadata {
  size: number;
  contentType: string | null;
  lastModified: string | null;
  storageClass: string | null;
  etag: string | null;
  metadata: Record<string, string>;
}

export async function headObject(
  client: S3Client,
  args: { bucket: string; key: string },
): Promise<Result<ObjectMetadata>> {
  try {
    const out = await client.send(
      new HeadObjectCommand({ Bucket: args.bucket, Key: args.key }),
    );
    return ok({
      size: out.ContentLength ?? 0,
      contentType: out.ContentType ?? null,
      lastModified: out.LastModified ? out.LastModified.toISOString() : null,
      storageClass: out.StorageClass ?? null,
      etag: out.ETag ?? null,
      metadata: out.Metadata ?? {},
    });
  } catch (e) {
    return toErr(e);
  }
}
