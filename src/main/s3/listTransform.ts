export interface FolderEntry {
  name: string;
  prefix: string;
}

export interface FileEntry {
  name: string;
  key: string;
  size: number;
  lastModified: string | null;
  storageClass: string | null;
  etag: string | null;
}

export interface Listing {
  folders: FolderEntry[];
  files: FileEntry[];
}

interface RawListOutput {
  CommonPrefixes?: { Prefix?: string }[];
  Contents?: {
    Key?: string;
    Size?: number;
    LastModified?: Date;
    StorageClass?: string;
    ETag?: string;
  }[];
}

export function transformListing(out: RawListOutput, prefix: string): Listing {
  const folders: FolderEntry[] = (out.CommonPrefixes ?? [])
    .map((cp) => cp.Prefix ?? '')
    .filter(Boolean)
    .map((p) => ({ name: stripPrefix(p, prefix).replace(/\/$/, ''), prefix: p }));

  const files: FileEntry[] = (out.Contents ?? [])
    .filter((c) => c.Key && c.Key !== prefix) // skip the folder placeholder key
    .map((c) => ({
      name: stripPrefix(c.Key!, prefix),
      key: c.Key!,
      size: c.Size ?? 0,
      lastModified: c.LastModified ? c.LastModified.toISOString() : null,
      storageClass: c.StorageClass ?? null,
      etag: c.ETag ?? null,
    }));

  return { folders, files };
}

function stripPrefix(key: string, prefix: string): string {
  return prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

export interface Crumb {
  label: string;
  prefix: string;
}

export function prefixToBreadcrumb(prefix: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'root', prefix: '' }];
  const segments = prefix.split('/').filter(Boolean);
  let acc = '';
  for (const seg of segments) {
    acc += `${seg}/`;
    crumbs.push({ label: seg, prefix: acc });
  }
  return crumbs;
}

export function parentPrefix(prefix: string): string {
  const segments = prefix.split('/').filter(Boolean);
  segments.pop();
  return segments.length ? `${segments.join('/')}/` : '';
}
