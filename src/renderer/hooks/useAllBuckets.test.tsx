import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAllBuckets } from './useAllBuckets';
import type { Account } from '../../main/storage/accountsRepo';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const accounts: Account[] = [
  { id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', forcePathStyle: false, createdAt: 1 },
  { id: 'acc-2', label: 'Hetzner', provider: 'hetzner', region: 'fsn1', accessKeyId: 'AK', forcePathStyle: false, createdAt: 2 },
];

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listBuckets: vi.fn((id: string) =>
      id === 'acc-1'
        ? Promise.resolve({ ok: true, data: ['assets', 'backups'] })
        : Promise.resolve({ ok: false, error: { code: 'AccessDenied', message: 'no' } }),
    ),
  };
});

describe('useAllBuckets', () => {
  it('returns per-account buckets and isolates a failing account', async () => {
    const { result } = renderHook(() => useAllBuckets(accounts), { wrapper: wrapper() });
    await waitFor(() => expect(result.current[0].isLoading).toBe(false));
    await waitFor(() => expect(result.current[1].isLoading).toBe(false));

    expect(result.current[0]).toMatchObject({ accountId: 'acc-1', buckets: ['assets', 'backups'], isError: false });
    expect(result.current[1]).toMatchObject({ accountId: 'acc-2', buckets: [], isError: true });
  });

  it('returns an empty array for no accounts', () => {
    const { result } = renderHook(() => useAllBuckets([]), { wrapper: wrapper() });
    expect(result.current).toEqual([]);
  });
});
