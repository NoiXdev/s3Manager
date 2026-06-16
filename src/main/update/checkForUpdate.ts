import { ok, err, type Result } from '../shared/result';

export const GITHUB_REPO = 'NoiXdev/s3Manager';
const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string;
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
}: {
  fetchImpl: typeof fetch;
  currentVersion: string;
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
    return ok({ currentVersion, latestVersion: null, updateAvailable: false, releaseUrl: RELEASES_PAGE });
  }
  if (!res.ok) {
    return err('UpdateCheckFailed', `GitHub responded ${res.status}`);
  }
  let body: { tag_name?: string; html_url?: string };
  try {
    body = (await res.json()) as { tag_name?: string; html_url?: string };
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
  });
}
