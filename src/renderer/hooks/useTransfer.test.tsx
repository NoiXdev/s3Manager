import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTransfer } from './useTransfer';

let client: QueryClient;
function wrapper() {
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    createFolder: vi.fn().mockResolvedValue({ ok: true, data: { key: 'p/new/' } }),
    moveObject: vi.fn().mockResolvedValue({ ok: true, data: { key: 'a/new.txt' } }),
    moveFolder: vi.fn().mockResolvedValue({ ok: true, data: { count: 2 } }),
  };
});

describe('useTransfer', () => {
  it('createFolder calls window.s3.createFolder and invalidates objects', async () => {
    const { result } = renderHook(() => useTransfer('acc-1', 'assets'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.createFolder.mutateAsync({ prefix: 'p/', name: 'new' });
    expect(window.s3.createFolder).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', prefix: 'p/', name: 'new' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objects', 'acc-1', 'assets'] });
  });

  it('moveObject and moveFolder forward their args', async () => {
    const { result } = renderHook(() => useTransfer('acc-1', 'assets'), { wrapper: wrapper() });
    await result.current.moveObject.mutateAsync({ sourceKey: 'a/old.txt', destKey: 'a/new.txt' });
    expect(window.s3.moveObject).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', sourceKey: 'a/old.txt', destKey: 'a/new.txt' });
    await result.current.moveFolder.mutateAsync({ sourcePrefix: 'old/', destPrefix: 'new/' });
    expect(window.s3.moveFolder).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', sourcePrefix: 'old/', destPrefix: 'new/' });
  });
});
