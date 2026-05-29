import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';
import { diffListings, type SyncObject, type SyncOp } from './syncDiff';

export interface Endpoint {
  accountId: string;
  bucket: string;
  prefix: string;
}

export interface SyncPlan {
  toCopy: number;
  upToDate: number;
  bytesToCopy: number;
  sample: SyncOp[];
}

export interface SyncFailure {
  key: string;
  code: string;
  message: string;
}

export interface SyncResult {
  copied: number;
  bytesCopied: number;
  failed: SyncFailure[];
  canceled: boolean;
}

export interface SyncProgress {
  phase: 'listing' | 'copying' | 'done';
  copied: number;
  total: number;
  bytesCopied: number;
  bytesTotal: number;
  failed: number;
  currentKey?: string;
}

const SAMPLE_LIMIT = 100;

/** Fully (recursively) list a bucket/prefix, returning objects with the prefix stripped from each key. */
export async function listAll(client: S3Client, bucket: string, prefix: string): Promise<SyncObject[]> {
  const out: SyncObject[] = [];
  let token: string | undefined;
  do {
    const r = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: token }),
    );
    for (const c of r.Contents ?? []) {
      const key = c.Key!;
      const relKey = key.slice(prefix.length);
      if (relKey === '') continue; // skip a folder marker whose key equals the prefix
      out.push({ relKey, size: c.Size ?? 0 });
    }
    token = r.NextContinuationToken;
  } while (token);
  return out;
}

export async function planSync(
  srcClient: S3Client,
  dstClient: S3Client,
  source: Endpoint,
  dest: Endpoint,
): Promise<Result<SyncPlan>> {
  try {
    const [srcList, dstList] = await Promise.all([
      listAll(srcClient, source.bucket, source.prefix),
      listAll(dstClient, dest.bucket, dest.prefix),
    ]);
    const ops = diffListings(srcList, dstList);
    const bytesToCopy = ops.reduce((n, o) => n + o.size, 0);
    return ok({
      toCopy: ops.length,
      upToDate: srcList.length - ops.length,
      bytesToCopy,
      sample: ops.slice(0, SAMPLE_LIMIT),
    });
  } catch (e) {
    return toErr(e);
  }
}
