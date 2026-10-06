import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useObjectVersions } from './useObjectVersions';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const versions = [{ versionId: 'v2', isLatest: true, isDeleteMarker: false, lastModified: '2024-03-01T00:00:00.000Z', size: 20, etag: '"e2"' }];

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listObjectVersions: vi.fn().mockResolvedValue({ ok: true, data: versions }),
    restoreObjectVersion: vi.fn().mockResolvedValue({ ok: true, data: true }),
    deleteObjectVersion: vi.fn().mockResolvedValue({ ok: true, data: true }),
    removeDeleteMarker: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('useObjectVersions', () => {
  it('loads versions', async () => {
    const { result } = renderHook(() => useObjectVersions('acc-1', 'b', 'a.txt'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.query.data).toEqual(versions);
  });

  it('is idle when objectKey is null', () => {
    const list = vi.fn();
    (window as unknown as { s3: unknown }).s3 = { listObjectVersions: list };
    const { result } = renderHook(() => useObjectVersions('acc-1', 'b', null), { wrapper: wrapper() });
    expect(result.current.query.fetchStatus).toBe('idle');
    expect(list).not.toHaveBeenCalled();
  });

  it('restore/remove/removeMarker send the version id', async () => {
    const { result } = renderHook(() => useObjectVersions('acc-1', 'b', 'a.txt'), { wrapper: wrapper() });
    await result.current.restore.mutateAsync('v1');
    await result.current.remove.mutateAsync('v1');
    await result.current.removeMarker.mutateAsync('dm1');
    expect(window.s3.restoreObjectVersion).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'b', key: 'a.txt', versionId: 'v1' });
    expect(window.s3.deleteObjectVersion).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'b', key: 'a.txt', versionId: 'v1' });
    expect(window.s3.removeDeleteMarker).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'b', key: 'a.txt', versionId: 'dm1' });
  });
});
