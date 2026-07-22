import { describe, it, expect, vi } from 'vitest';
import { compareVersions, checkForUpdate, pickInstallerAsset, type ReleaseAsset } from './checkForUpdate';

function fakeFetch(impl: { status: number; body?: unknown; throwError?: string; jsonThrows?: boolean }) {
  return vi.fn().mockImplementation(async () => {
    if (impl.throwError) throw new Error(impl.throwError);
    return {
      status: impl.status,
      ok: impl.status >= 200 && impl.status < 300,
      json: async () => {
        if (impl.jsonThrows) throw new Error('bad json');
        return impl.body;
      },
    } as Response;
  }) as unknown as typeof fetch;
}

describe('compareVersions', () => {
  it('compares numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });
  it('treats equal versions as 0 and strips a leading v', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });
  it('ignores a pre-release suffix on the core comparison', () => {
    expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(0);
  });
  it('reports an older version as negative', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
  });
  it('treats 1.2 and 1.2.0 as equal (segment padding)', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });
  it('does not crash on a non-numeric segment', () => {
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0);
  });
});

describe('pickInstallerAsset', () => {
  const assets: ReleaseAsset[] = [
    { name: 's3Manager-2.0.0-arm64.dmg', downloadUrl: 'https://x/arm64.dmg', size: 1 },
    { name: 's3Manager-2.0.0-x64.dmg', downloadUrl: 'https://x/x64.dmg', size: 2 },
    { name: 's3Manager-2.0.0.Setup.exe', downloadUrl: 'https://x/setup.exe', size: 3 },
    { name: 's3manager_2.0.0_amd64.deb', downloadUrl: 'https://x/amd64.deb', size: 4 },
    { name: 's3manager-2.0.0.x86_64.rpm', downloadUrl: 'https://x/x86_64.rpm', size: 5 },
  ];

  it('picks the arch-matching .dmg on macOS', () => {
    expect(pickInstallerAsset(assets, 'darwin', 'arm64')?.name).toBe('s3Manager-2.0.0-arm64.dmg');
    expect(pickInstallerAsset(assets, 'darwin', 'x64')?.name).toBe('s3Manager-2.0.0-x64.dmg');
  });

  it('picks the .exe on Windows', () => {
    expect(pickInstallerAsset(assets, 'win32', 'x64')?.name).toBe('s3Manager-2.0.0.Setup.exe');
  });

  it('prefers .deb over .rpm on Linux and honors arch aliases', () => {
    expect(pickInstallerAsset(assets, 'linux', 'x64')?.name).toBe('s3manager_2.0.0_amd64.deb');
  });

  it('falls back to the first matching-ext asset when no arch token matches', () => {
    const only = [{ name: 'app.dmg', downloadUrl: 'https://x/a.dmg', size: 1 }];
    expect(pickInstallerAsset(only, 'darwin', 'arm64')?.name).toBe('app.dmg');
  });

  it('returns null for an unknown platform or when nothing matches', () => {
    expect(pickInstallerAsset(assets, 'aix', 'x64')).toBeNull();
    expect(pickInstallerAsset([{ name: 'notes.txt', downloadUrl: 'https://x/n.txt', size: 1 }], 'darwin', 'arm64')).toBeNull();
  });
});

describe('checkForUpdate', () => {
  it('reports an available update from a newer tag', async () => {
    const res = await checkForUpdate({
      fetchImpl: fakeFetch({ status: 200, body: { tag_name: 'v2.0.0', html_url: 'https://example/r' } }),
      currentVersion: '1.0.0',
    });
    expect(res).toEqual({ ok: true, data: { currentVersion: '1.0.0', latestVersion: '2.0.0', updateAvailable: true, releaseUrl: 'https://example/r', installer: null } });
  });

  it('selects the platform/arch installer from release assets when an update is available', async () => {
    const res = await checkForUpdate({
      fetchImpl: fakeFetch({
        status: 200,
        body: {
          tag_name: 'v2.0.0',
          html_url: 'https://example/r',
          assets: [
            { name: 's3Manager-2.0.0-arm64.dmg', browser_download_url: 'https://github.com/a/arm64.dmg', size: 10 },
            { name: 's3Manager-2.0.0-x64.dmg', browser_download_url: 'https://github.com/a/x64.dmg', size: 11 },
          ],
        },
      }),
      currentVersion: '1.0.0',
      platform: 'darwin',
      arch: 'arm64',
    });
    expect(res.ok && res.data.installer).toEqual({ name: 's3Manager-2.0.0-arm64.dmg', downloadUrl: 'https://github.com/a/arm64.dmg', size: 10 });
  });

  it('does not offer an installer when the tag is not newer', async () => {
    const res = await checkForUpdate({
      fetchImpl: fakeFetch({
        status: 200,
        body: {
          tag_name: 'v1.0.0',
          html_url: 'https://example/r',
          assets: [{ name: 'app-1.0.0-x64.dmg', browser_download_url: 'https://github.com/a/x64.dmg', size: 10 }],
        },
      }),
      currentVersion: '1.0.0',
      platform: 'darwin',
      arch: 'x64',
    });
    expect(res.ok && res.data.installer).toBeNull();
  });

  it('reports up to date when the tag matches', async () => {
    const res = await checkForUpdate({
      fetchImpl: fakeFetch({ status: 200, body: { tag_name: 'v1.0.0', html_url: 'https://example/r' } }),
      currentVersion: '1.0.0',
    });
    expect(res.ok && res.data.updateAvailable).toBe(false);
  });

  it('treats a 404 (no releases) as up to date with the releases page url', async () => {
    const res = await checkForUpdate({ fetchImpl: fakeFetch({ status: 404 }), currentVersion: '1.0.0' });
    expect(res).toEqual({ ok: true, data: { currentVersion: '1.0.0', latestVersion: null, updateAvailable: false, releaseUrl: 'https://github.com/NoiXdev/s3Manager/releases', installer: null } });
  });

  it('returns an error on a non-OK response', async () => {
    const res = await checkForUpdate({ fetchImpl: fakeFetch({ status: 403 }), currentVersion: '1.0.0' });
    expect(res.ok).toBe(false);
  });

  it('returns an error when the request throws', async () => {
    const res = await checkForUpdate({ fetchImpl: fakeFetch({ status: 0, throwError: 'offline' }), currentVersion: '1.0.0' });
    expect(res.ok).toBe(false);
  });

  it('returns an error when the body cannot be parsed', async () => {
    const res = await checkForUpdate({ fetchImpl: fakeFetch({ status: 200, jsonThrows: true }), currentVersion: '1.0.0' });
    expect(res.ok).toBe(false);
  });

  it('treats a 200 response with no tag as up to date', async () => {
    const res = await checkForUpdate({ fetchImpl: fakeFetch({ status: 200, body: {} }), currentVersion: '1.0.0' });
    expect(res).toEqual({ ok: true, data: { currentVersion: '1.0.0', latestVersion: null, updateAvailable: false, releaseUrl: 'https://github.com/NoiXdev/s3Manager/releases', installer: null } });
  });
});
