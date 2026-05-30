import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useObjectAcl } from './useObjectAcl';

let client: QueryClient;
function wrapper() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const ACL = { owner: { id: 'o', displayName: 'me' }, grants: [] };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    getObjectAcl: vi.fn().mockResolvedValue({ ok: true, data: ACL }),
    putObjectAcl: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('useObjectAcl', () => {
  it('loads the ACL', async () => {
    const { result } = renderHook(() => useObjectAcl('a', 'b', 'k'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.acl.isSuccess).toBe(true));
    expect(result.current.acl.data).toEqual(ACL);
  });

  it('save calls putObjectAcl and invalidates the acl + visibility queries', async () => {
    const { result } = renderHook(() => useObjectAcl('a', 'b', 'k'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.save.mutateAsync({ owner: { id: 'o', displayName: 'me' }, grants: [] });
    expect(window.s3.putObjectAcl).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'k', acl: { owner: { id: 'o', displayName: 'me' }, grants: [] } });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objectAcl', 'a', 'b', 'k'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objectVisibility', 'a', 'b', 'k'] });
  });
});
