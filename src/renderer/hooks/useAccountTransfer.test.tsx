import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useExportAccounts, useImportAccounts, useImportPreview } from './useAccountTransfer';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: {
      export: vi.fn().mockResolvedValue({ ok: true, data: 'BLOB' }),
      import: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'n1' }] }),
      importPreview: vi.fn().mockResolvedValue({ ok: true, data: { encrypted: false, accounts: [{ label: 'AWS', provider: 'amazon-s3' }] } }),
    },
  };
});

describe('useExportAccounts', () => {
  it('returns the export string', async () => {
    const { result } = renderHook(() => useExportAccounts(), { wrapper: wrapper() });
    result.current.mutate({ accountIds: ['a'], password: 'pw' });
    await waitFor(() => expect(result.current.data).toBe('BLOB'));
    expect((window.s3 as unknown as { accounts: { export: ReturnType<typeof vi.fn> } }).accounts.export)
      .toHaveBeenCalledWith({ accountIds: ['a'], password: 'pw' });
  });
});

describe('useImportAccounts', () => {
  it('returns the imported accounts', async () => {
    const { result } = renderHook(() => useImportAccounts(), { wrapper: wrapper() });
    result.current.mutate({ blob: 'BLOB' });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'n1' }]));
  });
});

describe('useImportPreview', () => {
  it('returns the preview payload', async () => {
    const { result } = renderHook(() => useImportPreview(), { wrapper: wrapper() });
    result.current.mutate({ blob: 'BLOB' });
    await waitFor(() => expect(result.current.data).toEqual({ encrypted: false, accounts: [{ label: 'AWS', provider: 'amazon-s3' }] }));
  });
});
