import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAccounts, useCreateAccount, useRemoveAccount, useTestConnection } from './useAccounts';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: {
      list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'a', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 }] }),
    },
  };
});

describe('useAccounts', () => {
  it('loads the account list', async () => {
    const { result } = renderHook(() => useAccounts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].label).toBe('AWS prod');
  });
});

describe('account mutations', () => {
  it('useCreateAccount calls accounts.create and returns the new account', async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, data: { id: 'b', label: 'H', provider: 'hetzner', region: 'fsn1', accessKeyId: 'AK', createdAt: 2 } });
    (window as unknown as { s3: unknown }).s3 = { accounts: { create, list: vi.fn().mockResolvedValue({ ok: true, data: [] }) } };
    const { result } = renderHook(() => useCreateAccount(), { wrapper: wrapper() });
    const created = await result.current.mutateAsync({ label: 'H', provider: 'hetzner', region: 'fsn1', accessKeyId: 'AK', secretAccessKey: 'SK' });
    expect(create).toHaveBeenCalled();
    expect(created.id).toBe('b');
  });

  it('useTestConnection returns true on success and throws the message on failure', async () => {
    const test = vi.fn().mockResolvedValue({ ok: false, error: { code: 'AccessDenied', message: 'bad key' } });
    (window as unknown as { s3: unknown }).s3 = { accounts: { test } };
    const { result } = renderHook(() => useTestConnection(), { wrapper: wrapper() });
    await expect(
      result.current.mutateAsync({ label: 'H', provider: 'hetzner', region: 'fsn1', accessKeyId: 'AK', secretAccessKey: 'SK' }),
    ).rejects.toThrow(/AccessDenied: bad key/);
  });

  it('useRemoveAccount calls accounts.remove', async () => {
    const remove = vi.fn().mockResolvedValue({ ok: true, data: true });
    (window as unknown as { s3: unknown }).s3 = { accounts: { remove, list: vi.fn().mockResolvedValue({ ok: true, data: [] }) } };
    const { result } = renderHook(() => useRemoveAccount(), { wrapper: wrapper() });
    await result.current.mutateAsync('a');
    expect(remove).toHaveBeenCalledWith('a');
  });
});
