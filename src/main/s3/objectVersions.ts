import { S3Client, ListObjectVersionsCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';
import { encodeCopyKey } from './transfer';

export interface ObjectVersion {
  versionId: string;
  isLatest: boolean;
  isDeleteMarker: boolean;
  lastModified: string | null;
  size: number | null;
  etag: string | null;
}

export async function listObjectVersions(
  client: S3Client,
  args: { bucket: string; key: string },
): Promise<Result<ObjectVersion[]>> {
  try {
    const out: ObjectVersion[] = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    do {
      const res = await client.send(
        new ListObjectVersionsCommand({
          Bucket: args.bucket,
          Prefix: args.key,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        }),
      );
      for (const v of res.Versions ?? []) {
        if (v.Key !== args.key || !v.VersionId) continue;
        out.push({
          versionId: v.VersionId,
          isLatest: v.IsLatest ?? false,
          isDeleteMarker: false,
          lastModified: v.LastModified ? v.LastModified.toISOString() : null,
          size: v.Size ?? null,
          etag: v.ETag ?? null,
        });
      }
      for (const d of res.DeleteMarkers ?? []) {
        if (d.Key !== args.key || !d.VersionId) continue;
        out.push({
          versionId: d.VersionId,
          isLatest: d.IsLatest ?? false,
          isDeleteMarker: true,
          lastModified: d.LastModified ? d.LastModified.toISOString() : null,
          size: null,
          etag: null,
        });
      }
      keyMarker = res.IsTruncated ? res.NextKeyMarker : undefined;
      versionIdMarker = res.IsTruncated ? res.NextVersionIdMarker : undefined;
    } while (keyMarker || versionIdMarker);

    out.sort((a, b) => {
      if (a.isLatest !== b.isLatest) return a.isLatest ? -1 : 1;
      const ta = a.lastModified ? Date.parse(a.lastModified) : 0;
      const tb = b.lastModified ? Date.parse(b.lastModified) : 0;
      return tb - ta;
    });
    return ok(out);
  } catch (e) {
    return toErr(e);
  }
}

export async function restoreObjectVersion(
  client: S3Client,
  args: { bucket: string; key: string; versionId: string },
): Promise<Result<true>> {
  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: args.bucket,
        CopySource: `${args.bucket}/${encodeCopyKey(args.key)}?versionId=${args.versionId}`,
        Key: args.key,
      }),
    );
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}

export async function deleteObjectVersion(
  client: S3Client,
  args: { bucket: string; key: string; versionId: string },
): Promise<Result<true>> {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: args.bucket, Key: args.key, VersionId: args.versionId }));
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}

export async function removeDeleteMarker(
  client: S3Client,
  args: { bucket: string; key: string; versionId: string },
): Promise<Result<true>> {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: args.bucket, Key: args.key, VersionId: args.versionId }));
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}
