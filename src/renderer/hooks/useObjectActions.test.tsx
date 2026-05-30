import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useObjectActions } from './useObjectActions';

let client: QueryClient;
function wrapper() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  (window as unknown as { s3: unknown }).s3 = {
    downloadObject: vi.fn().mockResolvedValue({ ok: true, data: { path: '/tmp/logo.png' } }),
    getSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 86400 } }),
    presignGet: vi.fn().mockResolvedValue({ ok: true, data: 'https://signed/x' }),
    deleteObject: vi.fn().mockResolvedValue({ ok: true, data: 1 }),
    deleteFolder: vi.fn().mockResolvedValue({ ok: true, data: 3 }),
  };
});

describe('useObjectActions', () => {
  it('copyPresignedUrl signs with the configured expiry and copies to the clipboard', async () => {
    const { result } = renderHook(() => useObjectActions('acc-1', 'assets'), { wrapper: wrapper() });
    await result.current.copyPresignedUrl('logo.png');
    expect(window.s3.presignGet).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'logo.png', expiresIn: 86400 });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://signed/x');
  });

  it('copyPresignedUrl falls back to 3600 when getSettings fails', async () => {
    (window.s3.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: { code: 'X', message: 'no' } });
    const { result } = renderHook(() => useObjectActions('acc-1', 'assets'), { wrapper: wrapper() });
    await result.current.copyPresignedUrl('logo.png');
    expect(window.s3.presignGet).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'logo.png', expiresIn: 3600 });
  });

  it('download calls downloadObject with the key', async () => {
    const { result } = renderHook(() => useObjectActions('acc-1', 'assets'), { wrapper: wrapper() });
    await result.current.download('logo.png');
    expect(window.s3.downloadObject).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'logo.png' });
  });

  it('deleteObject deletes and invalidates the bucket listings', async () => {
    const { result } = renderHook(() => useObjectActions('acc-1', 'assets'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.deleteObject('logo.png');
    expect(window.s3.deleteObject).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'logo.png' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objects', 'acc-1', 'assets'] });
  });

  it('deleteFolder deletes and invalidates', async () => {
    const { result } = renderHook(() => useObjectActions('acc-1', 'assets'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.deleteFolder('images/');
    expect(window.s3.deleteFolder).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', prefix: 'images/' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objects', 'acc-1', 'assets'] });
  });
});
