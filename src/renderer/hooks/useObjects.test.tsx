import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useObjects } from './useObjects';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listObjects: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        folders: [{ name: 'thumbs', prefix: 'images/thumbs/' }],
        files: [{ name: 'logo.png', key: 'images/logo.png', size: 10, lastModified: null, storageClass: null, etag: null }],
        nextToken: null,
      },
    }),
  };
});

describe('useObjects', () => {
  it('loads folders and files for a prefix', async () => {
    const { result } = renderHook(() => useObjects('acc-1', 'assets', 'images/'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.folders).toEqual([{ name: 'thumbs', prefix: 'images/thumbs/' }]);
    expect(result.current.files.map((f) => f.name)).toEqual(['logo.png']);
    expect(result.current.query.hasNextPage).toBe(false);
  });

  it('is idle when bucket is null', () => {
    const list = vi.fn();
    (window as unknown as { s3: unknown }).s3 = { listObjects: list };
    const { result } = renderHook(() => useObjects('acc-1', null, ''), { wrapper: wrapper() });
    expect(result.current.query.fetchStatus).toBe('idle');
    expect(list).not.toHaveBeenCalled();
  });
});
