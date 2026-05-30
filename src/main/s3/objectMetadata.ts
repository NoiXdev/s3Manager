import { S3Client, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';
import { encodeCopyKey } from './transfer';

export interface EditableMetadata {
  contentType: string | null;
  cacheControl: string | null;
  contentDisposition: string | null;
  metadata: Record<string, string>;
}

export async function getEditableMetadata(
  client: S3Client,
  args: { bucket: string; key: string },
): Promise<Result<EditableMetadata>> {
  try {
    const out = await client.send(new HeadObjectCommand({ Bucket: args.bucket, Key: args.key }));
    return ok({
      contentType: out.ContentType ?? null,
      cacheControl: out.CacheControl ?? null,
      contentDisposition: out.ContentDisposition ?? null,
      metadata: out.Metadata ?? {},
    });
  } catch (e) {
    return toErr(e);
  }
}

export async function updateObjectMetadata(
  client: S3Client,
  args: {
    bucket: string;
    key: string;
    contentType: string | null;
    cacheControl: string | null;
    contentDisposition: string | null;
    metadata: Record<string, string>;
  },
): Promise<Result<true>> {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: args.bucket, Key: args.key }));
    // null or empty string clears the header; preserved system headers are re-sent from the head response
    await client.send(
      new CopyObjectCommand({
        Bucket: args.bucket,
        Key: args.key,
        CopySource: `${args.bucket}/${encodeCopyKey(args.key)}`,
        MetadataDirective: 'REPLACE',
        ContentType: args.contentType || undefined,
        CacheControl: args.cacheControl || undefined,
        ContentDisposition: args.contentDisposition || undefined,
        ContentEncoding: head.ContentEncoding,
        ContentLanguage: head.ContentLanguage,
        StorageClass: head.StorageClass,
        Metadata: args.metadata,
      }),
    );
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}
