import { ok, err, type Result } from '../shared/result';

export const GITHUB_REPO = 'NoiXdev/s3Manager';
const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
  size: number;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string;
  /** The release asset to download & open for this platform/arch, or null if none matches (e.g. Linux without a matching package, or unknown platform). */
  installer: ReleaseAsset | null;
}

interface GithubAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
}

/** Node arch → substrings that commonly appear in release asset file names for that arch. */
const ARCH_ALIASES: Record<string, string[]> = {
  arm64: ['arm64', 'aarch64'],
  x64: ['x64', 'x86_64', 'amd64'],
  ia32: ['ia32', 'x86', 'i386'],
};

/** File-name suffix that identifies the installer for each platform (electron-forge makers). */
const PLATFORM_EXT: Record<string, string[]> = {
  darwin: ['.dmg'],
  win32: ['.exe'],
  // Prefer .deb, fall back to .rpm — the order here is the preference order.
  linux: ['.deb', '.rpm'],
};

/**
 * Pick the installer asset matching this platform/arch from a release's assets.
 * Prefers an asset whose name also mentions the current arch; otherwise falls
 * back to the first asset with the right extension. Pure — no process access.
 */
export function pickInstallerAsset(
  assets: ReleaseAsset[],
  platform: string,
  arch: string,
): ReleaseAsset | null {
  const exts = PLATFORM_EXT[platform];
  if (!exts) return null;
  const archTokens = ARCH_ALIASES[arch] ?? [arch];
  for (const ext of exts) {
    const matches = assets.filter((a) => a.name.toLowerCase().endsWith(ext));
    if (matches.length === 0) continue;
    const archMatch = matches.find((a) =>
      archTokens.some((tok) => a.name.toLowerCase().includes(tok)),
    );
    return archMatch ?? matches[0];
  }
  return null;
}

function parseAssets(assets: GithubAsset[] | undefined): ReleaseAsset[] {
  if (!Array.isArray(assets)) return [];
  return assets
    .filter((a): a is Required<Pick<GithubAsset, 'name' | 'browser_download_url'>> & GithubAsset =>
      typeof a?.name === 'string' && typeof a?.browser_download_url === 'string',
    )
    .map((a) => ({ name: a.name, downloadUrl: a.browser_download_url, size: a.size ?? 0 }));
}

/** Parse "v1.2.3" / "1.2.3-beta.1" into [1,2,3]; ignores a leading v and any -prerelease suffix. */
// Pre-release suffixes are dropped: this app does not ship pre-releases, so 1.2.3-beta == 1.2.3 for comparison.
function parseVersion(v: string): number[] {
  const core = v.replace(/^v/i, '').split('-')[0];
  return core.split('.').map((p) => Number.parseInt(p, 10) || 0);
}

/** >0 if a is newer than b, 0 if equal, <0 if older. Compares major.minor.patch numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export async function checkForUpdate({
  fetchImpl,
  currentVersion,
  platform = process.platform,
  arch = process.arch,
}: {
  fetchImpl: typeof fetch;
  currentVersion: string;
  platform?: string;
  arch?: string;
}): Promise<Result<UpdateInfo>> {
  let res: Response;
  try {
    res = await fetchImpl(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 's3Manager-update-check' },
    });
  } catch (e) {
    return err('UpdateCheckFailed', (e as Error).message);
  }
  if (res.status === 404) {
    return ok({ currentVersion, latestVersion: null, updateAvailable: false, releaseUrl: RELEASES_PAGE, installer: null });
  }
  if (!res.ok) {
    return err('UpdateCheckFailed', `GitHub responded ${res.status}`);
  }
  let body: { tag_name?: string; html_url?: string; assets?: GithubAsset[] };
  try {
    body = (await res.json()) as { tag_name?: string; html_url?: string; assets?: GithubAsset[] };
  } catch (e) {
    return err('UpdateCheckFailed', (e as Error).message);
  }
  const tag = body.tag_name ?? '';
  const latestVersion = tag.replace(/^v/i, '') || null;
  const updateAvailable = tag !== '' && compareVersions(tag, currentVersion) > 0;
  return ok({
    currentVersion,
    latestVersion,
    updateAvailable,
    releaseUrl: updateAvailable ? (body.html_url ?? RELEASES_PAGE) : RELEASES_PAGE,
    // Only offer a direct installer for an actual newer release.
    installer: updateAvailable ? pickInstallerAsset(parseAssets(body.assets), platform, arch) : null,
  });
}
