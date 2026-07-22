import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { ok, err, type Result } from '../shared/result';

/**
 * Only GitHub-owned hosts may be downloaded from. `browser_download_url`s live
 * on github.com and redirect to *.githubusercontent.com asset storage; fetch
 * follows those redirects, so validating the initial URL's host is sufficient.
 * This guards against a compromised/spoofed renderer handing us an arbitrary URL.
 */
export function isAllowedDownloadHost(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return host === 'github.com' || host === 'githubusercontent.com' || host.endsWith('.githubusercontent.com');
}

/** Strip any path/traversal from an asset name, keeping only a safe base file name. */
function safeFileName(name: string): string {
  const base = path.basename(name).replace(/[/\\]/g, '');
  return base.length > 0 ? base : 'installer';
}

/**
 * Download a release installer to `destDir` and resolve its absolute path.
 * The caller is responsible for opening it (e.g. shell.openPath). The URL host
 * is validated against the GitHub allowlist before any request is made.
 */
export async function downloadInstaller({
  url,
  fileName,
  destDir,
  fetchImpl,
}: {
  url: string;
  fileName: string;
  destDir: string;
  fetchImpl: typeof fetch;
}): Promise<Result<{ path: string }>> {
  if (!isAllowedDownloadHost(url)) {
    return err('UpdateDownloadFailed', 'Refusing to download from a non-GitHub host');
  }

  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': 's3Manager-update-download' } });
  } catch (e) {
    return err('UpdateDownloadFailed', (e as Error).message);
  }
  if (!res.ok || !res.body) {
    return err('UpdateDownloadFailed', `Download responded ${res.status}`);
  }

  const target = path.join(destDir, safeFileName(fileName));
  try {
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(target));
  } catch (e) {
    return err('UpdateDownloadFailed', (e as Error).message);
  }
  return ok({ path: target });
}
