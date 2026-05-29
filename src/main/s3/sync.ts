import { S3Client, ListObjectsV2Command, CopyObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';
import { diffListings, type SyncObject, type SyncOp } from './syncDiff';
import { encodeCopyKey } from './transfer';
import { runPool } from './pool';
import type { Readable } from 'node:stream';

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

const CONCURRENCY = 6;

export async function copyOne(
  srcClient: S3Client,
  dstClient: S3Client,
  source: Endpoint,
  dest: Endpoint,
  op: SyncOp,
  sameAccount: boolean,
): Promise<void> {
  const sourceKey = source.prefix + op.relKey;
  const destKey = dest.prefix + op.relKey;
  if (sameAccount) {
    await dstClient.send(
      new CopyObjectCommand({
        Bucket: dest.bucket,
        CopySource: `${source.bucket}/${encodeCopyKey(sourceKey)}`,
        Key: destKey,
      }),
    );
    return;
  }
  const out = await srcClient.send(new GetObjectCommand({ Bucket: source.bucket, Key: sourceKey }));
  await new Upload({
    client: dstClient,
    params: { Bucket: dest.bucket, Key: destKey, Body: out.Body as Readable, ContentType: out.ContentType },
  }).done();
}

export interface RunSyncOptions {
  sameAccount: boolean;
  onProgress?: (p: SyncProgress) => void;
  signal?: AbortSignal;
}

export async function runSync(
  srcClient: S3Client,
  dstClient: S3Client,
  source: Endpoint,
  dest: Endpoint,
  opts: RunSyncOptions,
): Promise<Result<SyncResult>> {
  const { sameAccount, onProgress, signal } = opts;
  try {
    onProgress?.({ phase: 'listing', copied: 0, total: 0, bytesCopied: 0, bytesTotal: 0, failed: 0 });
    const [srcList, dstList] = await Promise.all([
      listAll(srcClient, source.bucket, source.prefix),
      listAll(dstClient, dest.bucket, dest.prefix),
    ]);
    const ops = diffListings(srcList, dstList);
    const total = ops.length;
    const bytesTotal = ops.reduce((n, o) => n + o.size, 0);

    let copied = 0;
    let bytesCopied = 0;
    let canceled = false;
    const failed: SyncFailure[] = [];
    const emit = (currentKey?: string) =>
      onProgress?.({ phase: 'copying', copied, total, bytesCopied, bytesTotal, failed: failed.length, currentKey });

    await runPool(ops, CONCURRENCY, async (op) => {
      if (signal?.aborted) {
        canceled = true;
        return;
      }
      try {
        await copyOne(srcClient, dstClient, source, dest, op, sameAccount);
        copied += 1;
        bytesCopied += op.size;
        emit(op.relKey);
      } catch (e) {
        failed.push({
          key: source.prefix + op.relKey,
          code: (e as { name?: string })?.name ?? 'UnknownError',
          message: (e as { message?: string })?.message ?? 'Unexpected error',
        });
        emit(op.relKey);
      }
    });

    onProgress?.({ phase: 'done', copied, total, bytesCopied, bytesTotal, failed: failed.length });
    return ok({ copied, bytesCopied, failed, canceled });
  } catch (e) {
    return toErr(e);
  }
}
