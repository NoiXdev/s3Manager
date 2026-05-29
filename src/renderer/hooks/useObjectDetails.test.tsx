import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useObjectDetails } from './useObjectDetails';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 10, contentType: 'image/png', lastModified: null, storageClass: 'STANDARD', etag: '"a"', metadata: { owner: 'me' } } }),
    objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'public' }),
  };
});

describe('useObjectDetails', () => {
  it('loads metadata and visibility for a key', async () => {
    const { result } = renderHook(() => useObjectDetails('acc-1', 'assets', 'logo.png'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.metadata.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.visibility.isSuccess).toBe(true));
    expect(result.current.metadata.data?.contentType).toBe('image/png');
    expect(result.current.visibility.data).toBe('public');
  });

  it('is idle when key is null', () => {
    const head = vi.fn();
    (window as unknown as { s3: unknown }).s3 = { headObject: head, objectVisibility: vi.fn() };
    const { result } = renderHook(() => useObjectDetails('acc-1', 'assets', null), { wrapper: wrapper() });
    expect(result.current.metadata.fetchStatus).toBe('idle');
    expect(head).not.toHaveBeenCalled();
  });

  it('setVisibility calls window.s3.setObjectVisibility and invalidates the visibility query', async () => {
    let client: QueryClient;
    const spyWrapper = () => {
      client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    };
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
      setObjectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'public' }),
    };
    const { result } = renderHook(() => useObjectDetails('a', 'b', 'k'), { wrapper: spyWrapper() });
    const spy = vi.spyOn(client!, 'invalidateQueries');
    await result.current.setVisibility.mutateAsync('public');
    expect(window.s3.setObjectVisibility).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'k', visibility: 'public' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objectVisibility', 'a', 'b', 'k'] });
  });
});
