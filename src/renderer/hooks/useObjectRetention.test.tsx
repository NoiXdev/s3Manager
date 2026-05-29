import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useObjectRetention } from './useObjectRetention';

let client: QueryClient;
function wrapper() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    getObjectRetention: vi.fn().mockResolvedValue({ ok: true, data: { mode: null, retainUntil: null } }),
    getObjectLegalHold: vi.fn().mockResolvedValue({ ok: true, data: 'OFF' }),
    putObjectRetention: vi.fn().mockResolvedValue({ ok: true, data: true }),
    putObjectLegalHold: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('useObjectRetention', () => {
  it('setRetention calls putObjectRetention and invalidates the retention query', async () => {
    const { result } = renderHook(() => useObjectRetention('a', 'b', 'k'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.setRetention.mutateAsync({ retainUntil: '2027-01-01T00:00:00.000Z' });
    expect(window.s3.putObjectRetention).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'k', retainUntil: '2027-01-01T00:00:00.000Z' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objectRetention', 'a', 'b', 'k'] });
  });

  it('setLegalHold calls putObjectLegalHold and invalidates the legal-hold query', async () => {
    const { result } = renderHook(() => useObjectRetention('a', 'b', 'k'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.setLegalHold.mutateAsync('ON');
    expect(window.s3.putObjectLegalHold).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'k', status: 'ON' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objectLegalHold', 'a', 'b', 'k'] });
  });

  it('loads the current retention and legal-hold values', async () => {
    const { result } = renderHook(() => useObjectRetention('a', 'b', 'k'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.retention.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.legalHold.isSuccess).toBe(true));
    expect(result.current.retention.data).toEqual({ mode: null, retainUntil: null });
    expect(result.current.legalHold.data).toBe('OFF');
  });
});
