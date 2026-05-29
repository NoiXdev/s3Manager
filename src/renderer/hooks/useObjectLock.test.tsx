import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useObjectLock } from './useObjectLock';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const status = { enabled: true, defaultRetention: { mode: 'GOVERNANCE', days: 30, years: null } };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    getObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: status }),
    putObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('useObjectLock', () => {
  it('loads the bucket lock status', async () => {
    const { result } = renderHook(() => useObjectLock('acc-1', 'assets'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.query.data).toEqual(status);
  });

  it('is idle when bucket is null', () => {
    const get = vi.fn();
    (window as unknown as { s3: unknown }).s3 = { getObjectLockConfig: get };
    const { result } = renderHook(() => useObjectLock('acc-1', null), { wrapper: wrapper() });
    expect(result.current.query.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });

  it('save sends the retention; clear sends null', async () => {
    const { result } = renderHook(() => useObjectLock('acc-1', 'assets'), { wrapper: wrapper() });
    await result.current.save.mutateAsync({ mode: 'COMPLIANCE', days: null, years: 1 });
    expect(window.s3.putObjectLockConfig).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', retention: { mode: 'COMPLIANCE', days: null, years: 1 } });
    await result.current.clear.mutateAsync();
    expect(window.s3.putObjectLockConfig).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', retention: null });
  });
});
