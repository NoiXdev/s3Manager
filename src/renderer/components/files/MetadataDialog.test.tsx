import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { MetadataDialog } from './MetadataDialog';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

function baseS3(over: Record<string, unknown> = {}) {
  return {
    getEditableMetadata: vi.fn().mockResolvedValue({
      ok: true,
      data: { contentType: 'text/plain', cacheControl: null, contentDisposition: null, metadata: { owner: 'me' } },
    }),
    updateObjectMetadata: vi.fn().mockResolvedValue({ ok: true, data: true }),
    ...over,
  };
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = baseS3();
});

describe('MetadataDialog', () => {
  it('seeds the Content-Type and existing custom metadata', async () => {
    wrap(<MetadataDialog accountId="a" bucket="b" objectKey="k" onClose={() => {}} />);
    expect(await screen.findByLabelText('Content-Type')).toHaveValue('text/plain');
    expect(screen.getByLabelText('Metadata key 1')).toHaveValue('owner');
    expect(screen.getByLabelText('Metadata value 1')).toHaveValue('me');
  });

  it('edits the content-type, adds a custom pair, and saves', async () => {
    wrap(<MetadataDialog accountId="a" bucket="b" objectKey="k" onClose={() => {}} />);
    const ct = await screen.findByLabelText('Content-Type');
    await userEvent.clear(ct);
    await userEvent.type(ct, 'application/json');
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await userEvent.type(screen.getByLabelText('Metadata key 2'), 'author');
    await userEvent.type(screen.getByLabelText('Metadata value 2'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save metadata' }));
    await waitFor(() => expect(window.s3.updateObjectMetadata).toHaveBeenCalled());
    const arg = (window.s3.updateObjectMetadata as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ accountId: 'a', bucket: 'b', key: 'k', contentType: 'application/json' });
    expect(arg.metadata).toEqual({ owner: 'me', author: 'x' });
  });

  it('shows a message when the metadata fails to load', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      getEditableMetadata: vi.fn().mockResolvedValue({ ok: false, error: { code: 'AccessDenied', message: 'denied' } }),
    });
    wrap(<MetadataDialog accountId="a" bucket="b" objectKey="k" onClose={() => {}} />);
    expect(await screen.findByText(/denied/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save metadata' })).toBeNull();
  });
});
