import { readdir, stat, mkdir } from 'node:fs/promises';
import { join, relative, sep, dirname } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { diffListings, type SyncObject, type SyncOp } from './syncDiff';
import { listAll, type Endpoint, type SyncPlan, type SyncResult, type SyncFailure, type SyncProgress } from './sync';
import { uploadObject, downloadObject, toErr } from './objects';
import { runPool } from './pool';

/** Recursively list regular files under `root` as SyncObjects (relKey uses '/'; dirs/symlinks skipped). */
export async function walkDir(root: string): Promise<SyncObject[]> {
  const out: SyncObject[] = [];
  async function recurse(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await recurse(full);
      } else if (entry.isFile()) {
        const s = await stat(full);
        out.push({ relKey: relative(root, full).split(sep).join('/'), size: s.size });
      }
    }
  }
  await recurse(root);
  return out;
}

const MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', txt: 'text/plain', csv: 'text/csv', xml: 'application/xml', pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', zip: 'application/zip',
};

/** Best-effort Content-Type from a file's extension; undefined when unknown. */
export function contentTypeFor(name: string): string | undefined {
  const i = name.lastIndexOf('.');
  if (i === -1) return undefined;
  return MIME[name.slice(i + 1).toLowerCase()];
}

export interface LocalSyncArgs {
  direction: 'upload' | 'download';
  localPath: string;
  remote: Endpoint;
}

const SAMPLE_LIMIT = 100;
const CONCURRENCY = 6;

async function sides(client: S3Client, args: LocalSyncArgs): Promise<{ source: SyncObject[]; dest: SyncObject[] }> {
  const [local, remote] = await Promise.all([
    walkDir(args.localPath),
    listAll(client, args.remote.bucket, args.remote.prefix),
  ]);
  return args.direction === 'upload' ? { source: local, dest: remote } : { source: remote, dest: local };
}

export async function planLocalSync(client: S3Client, args: LocalSyncArgs): Promise<Result<SyncPlan>> {
  try {
    const { source, dest } = await sides(client, args);
    const ops = diffListings(source, dest);
    return ok({
      toCopy: ops.length,
      upToDate: source.length - ops.length,
      bytesToCopy: ops.reduce((n, o) => n + o.size, 0),
      sample: ops.slice(0, SAMPLE_LIMIT),
    });
  } catch (e) {
    return toErr(e);
  }
}

function throwIfErr(r: Result<unknown>): void {
  if (!r.ok) throw Object.assign(new Error(r.error.message), { name: r.error.code });
}

export async function uploadOne(client: S3Client, args: LocalSyncArgs, op: SyncOp): Promise<void> {
  const filePath = join(args.localPath, ...op.relKey.split('/'));
  throwIfErr(
    await uploadObject(client, {
      bucket: args.remote.bucket,
      key: args.remote.prefix + op.relKey,
      filePath,
      contentType: contentTypeFor(op.relKey),
    }),
  );
}

export async function downloadOne(client: S3Client, args: LocalSyncArgs, op: SyncOp): Promise<void> {
  const destPath = join(args.localPath, ...op.relKey.split('/'));
  await mkdir(dirname(destPath), { recursive: true });
  throwIfErr(await downloadObject(client, { bucket: args.remote.bucket, key: args.remote.prefix + op.relKey, destPath }));
}

export interface RunLocalSyncOptions {
  onProgress?: (p: SyncProgress) => void;
  signal?: AbortSignal;
}

export async function runLocalSync(
  client: S3Client,
  args: LocalSyncArgs,
  opts: RunLocalSyncOptions,
): Promise<Result<SyncResult>> {
  const { onProgress, signal } = opts;
  try {
    onProgress?.({ phase: 'listing', copied: 0, total: 0, bytesCopied: 0, bytesTotal: 0, failed: 0 });
    const { source, dest } = await sides(client, args);
    const ops = diffListings(source, dest);
    const total = ops.length;
    const bytesTotal = ops.reduce((n, o) => n + o.size, 0);
    const transfer = args.direction === 'upload' ? uploadOne : downloadOne;

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
        await transfer(client, args, op);
        copied += 1;
        bytesCopied += op.size;
        emit(op.relKey);
      } catch (e) {
        failed.push({
          key: op.relKey,
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
