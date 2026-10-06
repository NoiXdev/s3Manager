import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useBucketVersioning } from './useBucketVersioning';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    getBucketVersioning: vi.fn().mockResolvedValue({ ok: true, data: { status: 'Enabled' } }),
    putBucketVersioning: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('useBucketVersioning', () => {
  it('loads the status', async () => {
    const { result } = renderHook(() => useBucketVersioning('acc-1', 'assets'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.query.data).toEqual({ status: 'Enabled' });
  });

  it('is idle when bucket is null', () => {
    const get = vi.fn();
    (window as unknown as { s3: unknown }).s3 = { getBucketVersioning: get };
    const { result } = renderHook(() => useBucketVersioning('acc-1', null), { wrapper: wrapper() });
    expect(result.current.query.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });

  it('setVersioning sends enabled', async () => {
    const { result } = renderHook(() => useBucketVersioning('acc-1', 'assets'), { wrapper: wrapper() });
    await result.current.setVersioning.mutateAsync(false);
    expect(window.s3.putBucketVersioning).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', enabled: false });
  });
});
