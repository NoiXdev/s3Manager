import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCors } from './useCors';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const rule = { id: null, allowedMethods: ['GET'], allowedOrigins: ['*'], allowedHeaders: [], exposeHeaders: [], maxAgeSeconds: null };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    getBucketCors: vi.fn().mockResolvedValue({ ok: true, data: [rule] }),
    putBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
    deleteBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('useCors', () => {
  it('loads the bucket CORS rules', async () => {
    const { result } = renderHook(() => useCors('acc-1', 'assets'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.query.data).toEqual([rule]);
  });

  it('is idle when bucket is null', () => {
    const get = vi.fn();
    (window as unknown as { s3: unknown }).s3 = { getBucketCors: get };
    const { result } = renderHook(() => useCors('acc-1', null), { wrapper: wrapper() });
    expect(result.current.query.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });

  it('save calls putBucketCors; clear calls deleteBucketCors', async () => {
    const { result } = renderHook(() => useCors('acc-1', 'assets'), { wrapper: wrapper() });
    await result.current.save.mutateAsync([rule]);
    expect(window.s3.putBucketCors).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', rules: [rule] });
    await result.current.clear.mutateAsync();
    expect(window.s3.deleteBucketCors).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets' });
  });
});
