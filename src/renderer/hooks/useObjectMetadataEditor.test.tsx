import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useObjectMetadataEditor } from './useObjectMetadataEditor';

let client: QueryClient;
function wrapper() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const EDITABLE = { contentType: 'text/plain', cacheControl: null, contentDisposition: null, metadata: { owner: 'me' } };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    getEditableMetadata: vi.fn().mockResolvedValue({ ok: true, data: EDITABLE }),
    updateObjectMetadata: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('useObjectMetadataEditor', () => {
  it('loads the editable metadata', async () => {
    const { result } = renderHook(() => useObjectMetadataEditor('a', 'b', 'k'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.editable.isSuccess).toBe(true));
    expect(result.current.editable.data).toEqual(EDITABLE);
  });

  it('update calls updateObjectMetadata and invalidates editable + objectMetadata queries', async () => {
    const { result } = renderHook(() => useObjectMetadataEditor('a', 'b', 'k'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.update.mutateAsync({ contentType: 'application/json', cacheControl: null, contentDisposition: null, metadata: { owner: 'me' } });
    expect(window.s3.updateObjectMetadata).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'k', contentType: 'application/json', cacheControl: null, contentDisposition: null, metadata: { owner: 'me' } });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['editableMetadata', 'a', 'b', 'k'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objectMetadata', 'a', 'b', 'k'] });
  });
});
