import { describe, it, expect, vi } from 'vitest';
import { compareVersions, checkForUpdate } from './checkForUpdate';

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

describe('checkForUpdate', () => {
  it('reports an available update from a newer tag', async () => {
    const res = await checkForUpdate({
      fetchImpl: fakeFetch({ status: 200, body: { tag_name: 'v2.0.0', html_url: 'https://example/r' } }),
      currentVersion: '1.0.0',
    });
    expect(res).toEqual({ ok: true, data: { currentVersion: '1.0.0', latestVersion: '2.0.0', updateAvailable: true, releaseUrl: 'https://example/r' } });
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
    expect(res).toEqual({ ok: true, data: { currentVersion: '1.0.0', latestVersion: null, updateAvailable: false, releaseUrl: 'https://github.com/NoiXdev/s3Manager/releases' } });
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
    expect(res).toEqual({ ok: true, data: { currentVersion: '1.0.0', latestVersion: null, updateAvailable: false, releaseUrl: 'https://github.com/NoiXdev/s3Manager/releases' } });
  });
});
