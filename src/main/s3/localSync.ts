import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { SyncObject } from './syncDiff';

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
