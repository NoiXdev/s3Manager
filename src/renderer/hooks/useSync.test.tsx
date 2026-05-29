import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSync } from './useSync';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const source = { accountId: 's', bucket: 'src', prefix: '' };
const dest = { accountId: 'd', bucket: 'dst', prefix: '' };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    planSync: vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 2, upToDate: 1, bytesToCopy: 100, sample: [] } }),
    runSync: vi.fn().mockResolvedValue({ ok: true, data: { copied: 2, bytesCopied: 100, failed: [], canceled: false } }),
    cancelSync: vi.fn().mockResolvedValue({ ok: true, data: true }),
    onSyncProgress: vi.fn(() => () => {}),
  };
});

describe('useSync', () => {
  it('plan calls window.s3.planSync', async () => {
    const { result } = renderHook(() => useSync(), { wrapper: wrapper() });
    const plan = await result.current.plan.mutateAsync({ source, dest });
    expect(window.s3.planSync).toHaveBeenCalledWith({ source, dest });
    expect(plan.toCopy).toBe(2);
  });

  it('run subscribes to progress, calls runSync, and resolves with the result', async () => {
    const { result } = renderHook(() => useSync(), { wrapper: wrapper() });
    let res!: { copied: number };
    await act(async () => {
      res = await result.current.run({ source, dest });
    });
    expect(window.s3.onSyncProgress).toHaveBeenCalled();
    expect(window.s3.runSync).toHaveBeenCalledWith({ source, dest });
    expect(res.copied).toBe(2);
  });

  it('cancel calls window.s3.cancelSync', async () => {
    const { result } = renderHook(() => useSync(), { wrapper: wrapper() });
    await act(async () => {
      result.current.cancel();
    });
    expect(window.s3.cancelSync).toHaveBeenCalled();
  });
});
