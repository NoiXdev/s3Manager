import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useBuckets } from './useBuckets';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets', 'backups'] }),
  };
});

describe('useBuckets', () => {
  it('loads buckets for an account', async () => {
    const { result } = renderHook(() => useBuckets('acc-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(['assets', 'backups']);
  });

  it('does not fetch when accountId is null', () => {
    const list = vi.fn();
    (window as unknown as { s3: unknown }).s3 = { listBuckets: list };
    const { result } = renderHook(() => useBuckets(null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(list).not.toHaveBeenCalled();
  });
});
