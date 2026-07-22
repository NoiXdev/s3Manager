import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { isAllowedDownloadHost, downloadInstaller } from './downloadInstaller';

describe('isAllowedDownloadHost', () => {
  it('allows github.com and *.githubusercontent.com over https', () => {
    expect(isAllowedDownloadHost('https://github.com/o/r/releases/download/v1/app.dmg')).toBe(true);
    expect(isAllowedDownloadHost('https://objects.githubusercontent.com/x')).toBe(true);
    expect(isAllowedDownloadHost('https://release-assets.githubusercontent.com/x')).toBe(true);
  });

  it('rejects non-GitHub hosts, http, and lookalikes', () => {
    expect(isAllowedDownloadHost('https://evil.com/app.dmg')).toBe(false);
    expect(isAllowedDownloadHost('http://github.com/app.dmg')).toBe(false);
    expect(isAllowedDownloadHost('https://github.com.evil.com/app.dmg')).toBe(false);
    expect(isAllowedDownloadHost('https://notgithubusercontent.com/x')).toBe(false);
    expect(isAllowedDownloadHost('not a url')).toBe(false);
  });
});

describe('downloadInstaller', () => {
  function streamFetch(bytes: string) {
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: Readable.toWeb(Readable.from([Buffer.from(bytes)])),
    }) as unknown as typeof fetch;
  }

  it('refuses a non-GitHub host before fetching', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const res = await downloadInstaller({ url: 'https://evil.com/app.dmg', fileName: 'app.dmg', destDir: tmpdir(), fetchImpl });
    expect(res.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('streams an allowed download to destDir and sanitizes the file name', async () => {
    const dir = path.join(tmpdir(), `s3m-dl-${process.pid}`);
    await mkdir(dir, { recursive: true });
    const res = await downloadInstaller({
      url: 'https://github.com/o/r/releases/download/v1/app.dmg',
      fileName: '../../../etc/app.dmg',
      destDir: dir,
      fetchImpl: streamFetch('binary-data'),
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.path).toBe(path.join(dir, 'app.dmg'));
      expect(await readFile(res.data.path, 'utf8')).toBe('binary-data');
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns an error on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, body: null }) as unknown as typeof fetch;
    const res = await downloadInstaller({ url: 'https://github.com/o/r/x.dmg', fileName: 'x.dmg', destDir: tmpdir(), fetchImpl });
    expect(res.ok).toBe(false);
  });
});
