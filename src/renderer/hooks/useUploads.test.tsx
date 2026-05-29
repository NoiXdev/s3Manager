import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useUploads } from './useUploads';

let progressCb: (p: { uploadId: string; loaded: number; total: number | null }) => void = () => {};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    getDropPath: vi.fn((f: File) => `/local/${f.name}`),
    uploadObject: vi.fn().mockResolvedValue({ ok: true, data: { key: 'images/a.txt' } }),
    onUploadProgress: vi.fn((cb: typeof progressCb) => {
      progressCb = cb;
      return () => {};
    }),
  };
});

describe('useUploads', () => {
  it('uploads a dropped file with a resolved path and prefixed key, then marks it done', async () => {
    const { result } = renderHook(() => useUploads('acc-1', 'assets'), { wrapper: wrapper() });
    const file = new File(['hi'], 'a.txt', { type: 'text/plain' });

    await act(async () => {
      await result.current.upload([file], 'images/');
    });

    expect(window.s3.getDropPath).toHaveBeenCalledWith(file);
    const call = (window.s3.uploadObject as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).toMatchObject({ accountId: 'acc-1', bucket: 'assets', key: 'images/a.txt', filePath: '/local/a.txt', contentType: 'text/plain' });
    expect(typeof call.uploadId).toBe('string');
    expect(result.current.items[0].name).toBe('a.txt');
    expect(result.current.items[0].status).toBe('done');
  });

  it('updates progress for the matching uploadId', async () => {
    let resolveUpload: (v: unknown) => void = () => {};
    (window as unknown as { s3: unknown }).s3 = {
      getDropPath: vi.fn((f: File) => `/local/${f.name}`),
      uploadObject: vi.fn(() => new Promise((res) => { resolveUpload = res; })),
      onUploadProgress: vi.fn((cb: typeof progressCb) => { progressCb = cb; return () => {}; }),
    };
    const { result } = renderHook(() => useUploads('acc-1', 'assets'), { wrapper: wrapper() });

    await act(async () => {
      void result.current.upload([new File(['x'], 'b.txt')], '');
    });
    const id = (window.s3.uploadObject as ReturnType<typeof vi.fn>).mock.calls[0][0].uploadId as string;

    act(() => progressCb({ uploadId: id, loaded: 40, total: 100 }));
    await waitFor(() => expect(result.current.items[0].loaded).toBe(40));
    expect(result.current.items[0].total).toBe(100);
    expect(result.current.items[0].status).toBe('uploading');

    await act(async () => { resolveUpload({ ok: true, data: { key: 'b.txt' } }); });
    await waitFor(() => expect(result.current.items[0].status).toBe('done'));
  });
});
