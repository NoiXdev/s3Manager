import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCreateBucket } from './useCreateBucket';

let client: QueryClient;
function wrapper() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    createBucket: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('useCreateBucket', () => {
  it('calls createBucket and invalidates the buckets query', async () => {
    const { result } = renderHook(() => useCreateBucket('acc-1'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.mutateAsync({ bucket: 'b', objectLock: true, versioning: true });
    expect(window.s3.createBucket).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'b', objectLock: true, versioning: true });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['buckets', 'acc-1'] });
  });
});
