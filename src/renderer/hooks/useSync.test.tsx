import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
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
  };
});

describe('useSync', () => {
  it('plan calls window.s3.planSync', async () => {
    const { result } = renderHook(() => useSync(), { wrapper: wrapper() });
    const plan = await result.current.plan.mutateAsync({ source, dest });
    expect(window.s3.planSync).toHaveBeenCalledWith({ source, dest });
    expect(plan.toCopy).toBe(2);
  });
});
