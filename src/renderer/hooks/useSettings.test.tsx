import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSettings } from './useSettings';

let client: QueryClient;
function wrapper() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    getSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600 } }),
    setSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 86400 } }),
    getAppInfo: vi.fn().mockResolvedValue({ ok: true, data: { version: '1.2.3', encryptionAvailable: true, accountCount: 2 } }),
  };
});

describe('useSettings', () => {
  it('loads settings and app info', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.settings.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.info.isSuccess).toBe(true));
    expect(result.current.settings.data).toEqual({ presignExpirySeconds: 3600 });
    expect(result.current.info.data?.version).toBe('1.2.3');
  });

  it('save calls setSettings and invalidates the settings query', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.save.mutateAsync({ presignExpirySeconds: 86400 });
    expect(window.s3.setSettings).toHaveBeenCalledWith({ presignExpirySeconds: 86400 });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['settings'] });
  });
});
