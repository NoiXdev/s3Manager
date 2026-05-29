import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useLocalSync } from './useLocalSync';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const args = { direction: 'upload' as const, localPath: '/data', remote: { accountId: 'a', bucket: 'b', prefix: '' } };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    localSyncPlan: vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 2, upToDate: 1, bytesToCopy: 100, sample: [] } }),
    localSyncRun: vi.fn().mockResolvedValue({ ok: true, data: { copied: 2, bytesCopied: 100, failed: [], canceled: false } }),
    cancelSync: vi.fn().mockResolvedValue({ ok: true, data: true }),
    onSyncProgress: vi.fn(() => () => {}),
  };
});

describe('useLocalSync', () => {
  it('plan calls window.s3.localSyncPlan', async () => {
    const { result } = renderHook(() => useLocalSync(), { wrapper: wrapper() });
    const plan = await result.current.plan.mutateAsync(args);
    expect(window.s3.localSyncPlan).toHaveBeenCalledWith(args);
    expect(plan.toCopy).toBe(2);
  });

  it('run subscribes to progress, calls localSyncRun, and resolves with the result', async () => {
    const { result } = renderHook(() => useLocalSync(), { wrapper: wrapper() });
    let res!: { copied: number };
    await act(async () => { res = await result.current.run(args); });
    expect(window.s3.onSyncProgress).toHaveBeenCalled();
    expect(window.s3.localSyncRun).toHaveBeenCalledWith(args);
    expect(res.copied).toBe(2);
  });

  it('cancel calls window.s3.cancelSync', async () => {
    const { result } = renderHook(() => useLocalSync(), { wrapper: wrapper() });
    await act(async () => { result.current.cancel(); });
    expect(window.s3.cancelSync).toHaveBeenCalled();
  });
});
