import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
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
  };
});

describe('useLocalSync', () => {
  it('plan calls window.s3.localSyncPlan', async () => {
    const { result } = renderHook(() => useLocalSync(), { wrapper: wrapper() });
    const plan = await result.current.plan.mutateAsync(args);
    expect(window.s3.localSyncPlan).toHaveBeenCalledWith(args);
    expect(plan.toCopy).toBe(2);
  });
});
