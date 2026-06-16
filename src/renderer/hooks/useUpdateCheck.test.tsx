import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useUpdateCheck } from './useUpdateCheck';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const info = { currentVersion: '1.0.0', latestVersion: '2.0.0', updateAvailable: true, releaseUrl: 'https://example/r' };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    checkForUpdate: vi.fn().mockResolvedValue({ ok: true, data: info }),
    setSettings: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  };
});

describe('useUpdateCheck', () => {
  it('returns the update info and records the check time', async () => {
    const { result } = renderHook(() => useUpdateCheck(), { wrapper: wrapper() });
    result.current.mutate();
    await waitFor(() => expect(result.current.data).toEqual(info));
    const setSettings = (window.s3 as unknown as { setSettings: ReturnType<typeof vi.fn> }).setSettings;
    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ lastUpdateCheckAt: expect.any(Number) }));
  });
});
